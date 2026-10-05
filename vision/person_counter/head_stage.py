"""
head_stage.py
=============

The single entry point app.py uses for the head feature. It runs head
detection, person-head association and head drawing for one frame - and
guarantees that NONE of it can ever break the existing pipeline.

Purpose / why it exists
-----------------------
The existing system (person detection -> ByteTrack -> counting) is the
product; heads are an optional extra. This module is the firewall between the
two:

    * If the head model fails to LOAD (missing file, wrong model type, no
      internet for the first download), the stage disables itself, prints one
      warning, and the app runs exactly as it did before.
    * If head inference fails on a FRAME, the exception is caught and logged,
      the frame simply has no head info, and tracking / counting carry on.

It also keeps app.py to orchestration only: app.py makes one call per frame
and does not need to know about models, geometry or overlays.

Diagnostics (all off unless HEAD_DEBUG / --head-debug)
------------------------------------------------------
Every HEAD_DEBUG_EVERY_N_FRAMES frames it prints a full per-pose-person trace
(body box, face keypoints with confidences, derived head box or reject reason,
what got attached to each track ID) and a one-line summary of counters
accumulated since the last print. See _accumulate() for how to read them.
The HUD always shows the head-stage time per frame.

Input / output
--------------
Input (per frame):
    clean_frame  - a copy of the camera frame taken BEFORE any overlay was
                   drawn, so the head model never sees boxes or labels.
    draw_frame   - the display frame the existing pipeline has drawn on.
    persons      - the person Detections the existing pipeline produced this
                   frame. Only their new `head` field is written, after counting.
Output:
    HUD text lines, and self.last_result: the latest AssociationResult, which
    is where any future feature should read "track 17's head" from.

Where it fits in the pipeline
-----------------------------
    frame ─┬─► existing pipeline.process()  (person detect -> ByteTrack -> count)
           │          │ persons (only .head is set)
           └─(copy)───┴─► HeadAssociationStage.process()
                              ├─ HeadDetector.detect()          head_detector.py
                              ├─ PersonHeadAssociator.associate() person_head_association.py
                              └─ draw_pose_keypoints() / draw_associations()  head_drawing.py

It uses the frame app.py already read - it never opens a camera or stream.

Future use
----------
This "optional stage with failure isolation" shape is the template for later
add-ons (pose, Re-ID, face recognition): each gets its own stage object that
consumes the same frame + persons and can fail without consequence.
"""

import os
import time
import traceback

import cv2

from . import head_config
from .head_detector import HeadDetector, KEYPOINT_NAMES, FACE_KEYPOINTS
from .head_drawing import draw_associations, draw_pose_keypoints, draw_raw_heads
from .person_head_association import AssociationResult, PersonHeadAssociator


# Print the full traceback for the first frame failure (so the cause can be
# diagnosed) and a one-line reminder every this many failures after that
# (so a persistent fault cannot flood the console at 10+ lines per second).
# In debug mode every failure gets a one-line message.
_REPORT_EVERY_N_FAILURES = 100

# Counters accumulated between debug summaries. The first six are copied from
# HeadDetector.last_stats; the last three are measured here after association.
_DETECTOR_COUNTERS = ["pose_persons", "with_face_keypoints", "rejected",
                      "heads_from_keypoints", "heads_estimated", "duplicates_removed"]
_COUNTERS = _DETECTOR_COUNTERS + ["matched", "unmatched_heads", "persons_without_head"]


class HeadAssociationStage:
    """Optional, failure-isolated head detection + association for each frame.

    Responsibility: own the head detector and associator, run them per frame,
    draw the result, keep diagnostics, and contain every error they raise.
    Why a class: the model must be loaded once and reused; counters, failure
    counts and the last result must persist between frames.

    State:
        enabled      - False if loading failed; process() is then a no-op.
        detector     - HeadDetector (None if loading failed).
        associator   - PersonHeadAssociator.
        last_result  - AssociationResult from the most recent frame (emptied
                       after a failed frame, so nothing stale is shown).
        last_ms      - head-stage wall time for the last frame, milliseconds.
        failures     - count of frames whose head processing raised.
        frame_index  - frames processed; drives the periodic debug output.
        _totals      - counters accumulated since the last debug summary.

    Relationship: created by app.run() when the feature is switched on;
    consumes Detections from the existing pipeline and sets only their `head`
    field, after counting has already run for the frame.
    """

    def __init__(self):
        """Try to load the head model. Never raises.

        Any problem is reported once and leaves the stage disabled, so the
        caller does not need its own try/except around construction.
        """
        self.enabled = False
        self.detector = None
        self.associator = PersonHeadAssociator()
        self.last_result = AssociationResult()
        self.last_ms = 0.0
        self.failures = 0
        self.frame_index = 0
        self.last_frame_shape = None
        self._no_head_reported = False   # first no-head frame is always reported
        self._reset_totals()

        try:
            self.detector = HeadDetector()
            self.enabled = True
        except Exception as error:  # noqa: BLE001 - isolation is the whole point
            # Broad on purpose: a missing file, a bad download, a wrong model
            # type and a CUDA problem all raise different exception types, and
            # every one of them must leave counting running normally.
            print(f"WARNING: head detection disabled - could not load the head "
                  f"model: {error}")
            print("         Person detection, tracking and counting continue normally.")

    def process(self, clean_frame, draw_frame, persons) -> list[str]:
        """Detect heads, associate them with persons, draw. Never raises.

        Parameters:
            clean_frame: un-annotated copy of this frame, fed to the head model.
            draw_frame:  the display frame, drawn on in place.
            persons:     list[Detection] from the existing pipeline THIS frame
                         (fresh objects every frame, so their .head starts as
                         None - nothing carries over from the previous frame).

        Returns:
            HUD lines to append to the existing ones (empty if disabled).
        """
        if not self.enabled:
            return []

        persons = persons or []
        self.frame_index += 1
        debug = head_config.get("HEAD_DEBUG")
        every = head_config.get("HEAD_DEBUG_EVERY_N_FRAMES") or 0
        report_now = bool(every) and self.frame_index % every == 0
        started = time.perf_counter()

        try:
            # 1. Heads from the CLEAN frame - the display frame already has
            #    person boxes, labels and the counting line painted on it.
            heads = self.detector.detect(clean_frame)

            # 2. Pair heads with the persons the existing tracker found.
            self.last_result = self.associator.associate(persons, heads)

            # 3. Attach each matched head to its person's existing track
            #    record (Detection.head), so anything holding the person -
            #    by track ID - now holds its head too. This is the ONLY write
            #    to a person, it touches only the new `head` field, and it
            #    happens after counter.update() has already run for this
            #    frame, so boxes, IDs, foot points and counts are unaffected.
            #    No new track is created for the head: it rides on the person's.
            for assoc in self.last_result.associations:
                assoc.person.head = assoc.head

            # Timed before drawing, so the number is the cost of detection +
            # association, comparable with and without the debug overlay.
            self.last_ms = (time.perf_counter() - started) * 1000
            self._accumulate()

            # 4. Overlays, on top of the existing drawing. Raw keypoints go
            #    UNDER the head boxes so both stay visible.
            if debug or head_config.get("HEAD_DRAW_POSE_KEYPOINTS"):
                draw_pose_keypoints(draw_frame, self.detector.last_pose_persons,
                                    head_config.get("HEAD_KEYPOINT_CONF"))
            if head_config.get("HEAD_DRAW"):
                draw_associations(draw_frame, self.last_result)
            if debug:
                # Temporary: red box + circle on EVERY raw head, last, so
                # nothing can hide it.
                draw_raw_heads(draw_frame, heads)

            # 5. Periodic diagnostics.
            self.last_frame_shape = clean_frame.shape
            if report_now:
                if debug:
                    self._print_trace(heads, persons)
                    self._print_summary()
                self._save_frame(draw_frame)
            if debug and not heads:
                self._report_no_head(clean_frame, report_now)

        except Exception as error:  # noqa: BLE001 - a head failure must not stop counting
            self._report_failure(error, debug)
            # Clear the result so no stale head data from an earlier frame is
            # presented as belonging to this one.
            self.last_result = AssociationResult()
            return ["Heads: error (counting unaffected)"]

        result = self.last_result
        all_heads = [a.head for a in result.associations] + result.unmatched_heads
        estimated = sum(h.estimated for h in all_heads)
        return [f"Heads: {len(all_heads)} ({estimated} est.)  "
                f"Matched: {len(result.associations)}  [{self.last_ms:.0f} ms]"]

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------
    def _reset_totals(self):
        """Zero the counters accumulated between debug summaries."""
        self._totals = {name: 0 for name in _COUNTERS}
        self._totals_ms = 0.0
        self._totals_frames = 0

    def _accumulate(self):
        """Add this frame's counters to the running totals.

        Read together, they say WHERE heads go missing:
            pose persons low            -> the pose MODEL is not finding people
            rejected high               -> bodies found, but no usable face
                                           keypoints (head-box generation)
            heads high, matched low     -> ASSOCIATION is rejecting them, or
                                           ByteTrack has no person there
            persons without head high   -> tracked people the pose model gave
                                           no head to (or association refused)
        """
        stats = self.detector.last_stats
        for name in _DETECTOR_COUNTERS:
            self._totals[name] += getattr(stats, name)
        self._totals["matched"] += len(self.last_result.associations)
        self._totals["unmatched_heads"] += len(self.last_result.unmatched_heads)
        self._totals["persons_without_head"] += len(self.last_result.persons_without_head)
        self._totals_ms += self.last_ms
        self._totals_frames += 1

    def _print_trace(self, heads, persons):
        """Print the full head pipeline for THIS frame, pose person by person.

        Format:
            POSE PERSON 1/2:
              person_box=(336, 110, 374, 202)
              pose_conf=0.34
            FACE KEYPOINTS:
              nose=(367,137) conf=0.66 used
              left_ear=(351,132) conf=0.09 below threshold
              ...
            HEAD:
              derived_box=(344,110,374,147) method=ears estimated=False
              head_center=(359, 128)
              confidence=0.25
            TOTAL POSE PERSONS: 2
            TOTAL HEADS CREATED: 2 (confirmed 2, estimated 0, duplicates removed 0)
            HEADS RETURNED TO STAGE: 2
            TRACK ID 1 person=(...) head=(...) head_point=(...)
        """
        min_conf = head_config.get("HEAD_KEYPOINT_CONF")
        pose_persons = self.detector.last_pose_persons
        stats = self.detector.last_stats
        print(f"\n===== [heads] frame {self.frame_index} =====")
        for i, pp in enumerate(pose_persons, start=1):
            print(f"POSE PERSON {i}/{len(pose_persons)}:")
            print(f"  person_box={pp.box}")
            print(f"  pose_conf={pp.confidence:.2f}")
            print("FACE KEYPOINTS:")
            for k in FACE_KEYPOINTS:
                x, y = pp.keypoints[k]
                if pp.is_visible(k, min_conf):
                    state = "used"
                elif x <= 0 or y <= 0:
                    state = "not placed"
                else:
                    state = "below threshold"
                print(f"  {KEYPOINT_NAMES[k]}=({int(x)},{int(y)}) "
                      f"conf={pp.keypoint_conf[k]:.2f} {state}")
            print("HEAD:")
            if pp.head is None:
                print(f"  none - {pp.reject_reason}")
            else:
                h = pp.head
                print(f"  derived_box=({h.x1},{h.y1},{h.x2},{h.y2}) "
                      f"method={h.method} estimated={h.estimated}")
                print(f"  head_center={h.head_point}")
                print(f"  confidence={h.confidence:.2f}")
        created = stats.heads_from_keypoints + stats.heads_estimated
        print(f"TOTAL POSE PERSONS: {stats.pose_persons} "
              f"(plus {stats.below_conf_threshold} below HEAD_CONF_THRESHOLD, not used)")
        print(f"TOTAL HEADS CREATED: {created} (confirmed {stats.heads_from_keypoints}, "
              f"estimated {stats.heads_estimated}, "
              f"duplicates removed {stats.duplicates_removed})")
        print(f"HEADS RETURNED TO STAGE: {len(heads)}")
        # The detector's actual return value, unmodified - exactly what
        # association receives this frame.
        print("Number of heads:", len(heads))
        print("Head detections:", heads)

        # What ended up attached to each existing tracked person.
        for person in persons:
            box = f"({person.x1},{person.y1},{person.x2},{person.y2})"
            h = person.head
            attached = ("None" if h is None else
                        f"({h.x1},{h.y1},{h.x2},{h.y2}) head_point={h.head_point}"
                        + (" ESTIMATED" if h.estimated else ""))
            print(f"TRACK ID {person.track_id} person={box} head={attached}")
        for h in self.last_result.unmatched_heads:
            print(f"UNMATCHED head=({h.x1},{h.y1},{h.x2},{h.y2})")

    def _print_summary(self):
        """One line of counters accumulated since the last summary."""
        t = self._totals
        avg_ms = self._totals_ms / max(1, self._totals_frames)
        shape = self.last_frame_shape
        dims = f"{shape[1]}x{shape[0]}" if shape is not None else "?"
        print(f"[heads] frame {self.frame_index} ({dims}), "
              f"last {self._totals_frames} frames: "
              f"pose persons={t['pose_persons']}, "
              f"with face keypoints={t['with_face_keypoints']}, "
              f"rejected={t['rejected']}, "
              f"heads confirmed={t['heads_from_keypoints']}, "
              f"estimated={t['heads_estimated']}, "
              f"duplicates removed={t['duplicates_removed']}, "
              f"matched={t['matched']}, unmatched heads={t['unmatched_heads']}, "
              f"persons without head={t['persons_without_head']}, "
              f"head stage avg {avg_ms:.0f} ms")
        self._reset_totals()

    def _report_no_head(self, clean_frame, report_now: bool):
        """DEBUG: a frame produced NO head - say exactly why, and save evidence.

        Reported on the first such frame, then on periodic report frames only,
        so a long empty stretch cannot flood the console or the disk. Saves:
            no_head_NNNNNN_frame.png     the frame exactly as the model saw it
            no_head_NNNNNN_raw_pose.png  that frame with the raw pose output
        into HEAD_DEBUG_SAVE_DIR (default heads_diagnostics/).
        """
        if self._no_head_reported and not report_now:
            return
        self._no_head_reported = True

        stats = self.detector.last_stats
        pose_persons = self.detector.last_pose_persons
        if not pose_persons:
            reason = ("the pose model returned NO body at all in this frame "
                      "(nobody visible, or too small/dark/occluded for it)")
        elif stats.pose_persons == 0:
            reason = (f"the pose model found {stats.below_conf_threshold} body(ies), all "
                      f"below HEAD_CONF_THRESHOLD {head_config.get('HEAD_CONF_THRESHOLD')}")
        else:
            reason = "every pose body was rejected: " + "; ".join(
                f"{n}x {r}" for r, n in stats.reject_reasons.items())
        print(f"[heads] frame {self.frame_index}: NO HEAD - {reason}")
        for pp in pose_persons:
            print(f"    body {pp.box} conf={pp.confidence:.2f} -> {pp.reject_reason}")

        folder = head_config.get("HEAD_DEBUG_SAVE_DIR") or "heads_diagnostics"
        os.makedirs(folder, exist_ok=True)
        stem = os.path.join(folder, f"no_head_{self.frame_index:06d}")
        cv2.imwrite(f"{stem}_frame.png", clean_frame)
        raw = clean_frame.copy()
        draw_pose_keypoints(raw, pose_persons, head_config.get("HEAD_KEYPOINT_CONF"))
        cv2.imwrite(f"{stem}_raw_pose.png", raw)
        print(f"    saved {stem}_frame.png and {stem}_raw_pose.png")

    def _save_frame(self, frame):
        """Save the annotated frame when HEAD_DEBUG_SAVE_DIR is set."""
        folder = head_config.get("HEAD_DEBUG_SAVE_DIR")
        if not folder:
            return
        os.makedirs(folder, exist_ok=True)
        cv2.imwrite(os.path.join(folder, f"heads_{self.frame_index:06d}.png"), frame)

    def _report_failure(self, error, debug: bool):
        """Log a frame failure without flooding the console."""
        self.failures += 1
        if self.failures == 1:
            print("WARNING: head processing failed on a frame; counting continues. "
                  "Details:")
            traceback.print_exc()
        elif debug:
            print(f"WARNING: head processing failed (frame {self.frame_index}): {error!r}")
        elif self.failures % _REPORT_EVERY_N_FAILURES == 0:
            print(f"WARNING: head processing has failed on {self.failures} frames "
                  f"(latest: {error!r}).")
