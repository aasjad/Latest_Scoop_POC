"""
diagnose_heads.py
=================

Standalone diagnostic for the head feature. Runs the SAME code the app uses
(PersonDetector + ByteTrack via TrackPipeline, then HeadAssociationStage) on a
supplied image or video file - no camera needed - and saves annotated output
showing every layer at once:

    white thin box + "pose 0.34"  raw pose-model body box and confidence
    coloured dots n/le/re/lE/rE   raw face keypoints (filled = used,
                                  hollow = below HEAD_KEYPOINT_CONF);
                                  yellow dots = shoulders
    "no head: <reason>"           a pose body that produced no head
    thick coloured box + "ID n"   tracked person (existing drawing, unchanged)
    small box + ringed dot        derived head box and head point,
      "head ID n"                 attached to track n (same colour)
      "est. head ..."             an ESTIMATED region, no face keypoint seen
      "head ?"                    a head that matched no tracked person
    thin line                     head -> person association

How to tell which stage is at fault, by eye:
    no white pose box on a person      -> pose model did not detect the body
    keypoints in the wrong places      -> pose model limitation
    keypoints right, head box wrong    -> head-box geometry (head_detector.py)
    head box right, wrong ID / "?"     -> association, or no ByteTrack track

Usage:
    python diagnose_heads.py photo.jpg
    python diagnose_heads.py clip.mp4 --max-frames 300 --every 10
    python diagnose_heads.py clip.mp4 --imgsz 480 --kp-conf 0.5   # compare settings

Output goes to heads_diagnostics/ (override with --out): one PNG per image, or
for a video:
    <name>_heads.mp4               every frame, fully annotated
    <name>_first_raw_pose.png      frame 1 with ONLY the raw pose output drawn
                                   (bodies + keypoints), before any head logic
    <name>_first_head_markers.png  the first frame that produced a head, with
                                   the final head markers
    <name>_per_frame.csv           per frame: tracked persons, pose persons,
                                   heads (confirmed / estimated), matched
    <name>_NNNNNN.png              a snapshot every --every frames
The full per-person trace is printed for images, for each of the first
--trace-first video frames, then every --every frames; whole-run counters
are printed at the end.
"""

import argparse
import os
import sys

import config
# Importing the package first sets FFmpeg's options before cv2 loads - same
# reason as in main.py.
import person_counter  # noqa: F401
import cv2

from person_counter import head_config
from person_counter.app import TrackPipeline
from person_counter.detector import PersonDetector
from person_counter.head_drawing import draw_pose_keypoints
from person_counter.head_stage import HeadAssociationStage

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def parse_args():
    parser = argparse.ArgumentParser(description="Annotate head detection on an image or video.")
    parser.add_argument("input", help="image or video file")
    parser.add_argument("--out", default="heads_diagnostics", help="output folder")
    parser.add_argument("--max-frames", type=int, default=0, help="stop after N frames (0 = all)")
    parser.add_argument("--every", type=int, default=10,
                        help="video: save a PNG and print the trace every N frames")
    parser.add_argument("--trace-first", type=int, default=10,
                        help="video: print the full trace for each of the first N frames")
    parser.add_argument("--imgsz", type=int, default=None, help="HEAD_INFERENCE_SIZE override")
    parser.add_argument("--conf", type=float, default=None, help="HEAD_CONF_THRESHOLD override")
    parser.add_argument("--kp-conf", type=float, default=None, help="HEAD_KEYPOINT_CONF override")
    parser.add_argument("--no-estimate", action="store_true",
                        help="do not estimate head regions for bodies without face keypoints")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not os.path.exists(args.input):
        print(f"Input not found: {args.input}")
        return 1

    # Overrides go onto the config module, exactly like main.py's flags, so
    # the stage reads them through head_config.get().
    if args.imgsz is not None:
        config.HEAD_INFERENCE_SIZE = args.imgsz
    if args.conf is not None:
        config.HEAD_CONF_THRESHOLD = args.conf
    if args.kp_conf is not None:
        config.HEAD_KEYPOINT_CONF = args.kp_conf
    if args.no_estimate:
        config.HEAD_ESTIMATE_WHEN_NO_FACE = False
    # Diagnostics on: raw keypoints drawn, trace printed every --every frames.
    config.HEAD_DEBUG = True
    config.HEAD_DEBUG_EVERY_N_FRAMES = args.every
    os.makedirs(args.out, exist_ok=True)

    # The app's own pipeline objects: person boxes, IDs and trails are drawn
    # by the existing drawing code, unchanged.
    pipeline = TrackPipeline(PersonDetector(), show_trails=False)
    stage = HeadAssociationStage()
    if not stage.enabled:
        return 1

    base = os.path.splitext(os.path.basename(args.input))[0]
    is_image = os.path.splitext(args.input)[1].lower() in _IMAGE_EXTS

    if is_image:
        frame = cv2.imread(args.input)
        if frame is None:
            print(f"Could not read image: {args.input}")
            return 1
        # A single image: force the trace for it regardless of --every.
        config.HEAD_DEBUG_EVERY_N_FRAMES = 1
        annotated = _process(pipeline, stage, frame)
        out_path = os.path.join(args.out, f"{base}_heads.png")
        cv2.imwrite(out_path, annotated)
        print(f"\nSaved {out_path}")
        return 0

    cap = cv2.VideoCapture(args.input)
    if not cap.isOpened():
        print(f"Could not open video: {args.input}")
        return 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 10.0
    print(f"Video: {int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x"
          f"{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))} @ {fps:.2f} fps, "
          f"{int(cap.get(cv2.CAP_PROP_FRAME_COUNT))} frames")
    writer = None
    saved_head_frame = False
    csv_path = os.path.join(args.out, f"{base}_per_frame.csv")
    csv = open(csv_path, "w", encoding="utf-8")
    csv.write("frame,tracked_persons,pose_persons,heads_confirmed,heads_estimated,matched\n")
    totals = {"frames": 0, "pose": 0, "faces": 0, "rejected": 0, "confirmed": 0,
              "estimated": 0, "matched": 0, "unmatched": 0, "no_head": 0, "ms": 0.0}

    while True:
        ok, frame = cap.read()
        if not ok or (args.max_frames and totals["frames"] >= args.max_frames):
            break
        n = totals["frames"] + 1
        if n == 1:
            # What the video loop actually hands the model - compare with the
            # same numbers for a still image (cv2.imread gives the same layout).
            print(f"First frame: shape={frame.shape} dtype={frame.dtype} "
                  f"(BGR, as from cv2.imread)")

        # Full trace for each of the first --trace-first frames, then every
        # --every frames. head_config.get() reads this at call time.
        config.HEAD_DEBUG_EVERY_N_FRAMES = 1 if n <= args.trace_first else args.every

        clean = frame.copy()
        annotated = _process(pipeline, stage, frame)
        s, r = stage.detector.last_stats, stage.last_result

        if n == 1:
            # Raw pose output only, drawn on an untouched copy: shows what the
            # model returned before any head geometry or association.
            raw = clean.copy()
            draw_pose_keypoints(raw, stage.detector.last_pose_persons,
                                head_config.get("HEAD_KEYPOINT_CONF"))
            cv2.imwrite(os.path.join(args.out, f"{base}_first_raw_pose.png"), raw)
        heads_now = len(r.associations) + len(r.unmatched_heads)
        if heads_now and not saved_head_frame:
            cv2.imwrite(os.path.join(args.out, f"{base}_first_head_markers.png"), annotated)
            print(f"[frame {n}] first frame with head markers saved")
            saved_head_frame = True

        if writer is None:
            h, w = annotated.shape[:2]
            video_path = os.path.join(args.out, f"{base}_heads.mp4")
            writer = cv2.VideoWriter(video_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
            if not writer.isOpened():
                # Loud, not silent: a writer that failed to open drops every
                # frame and leaves an empty file that looks like "no heads".
                print(f"ERROR: could not open video writer for {video_path} ({w}x{h})")
        writer.write(annotated)

        tracked = len(pipeline.last_detections)
        csv.write(f"{n},{tracked},{s.pose_persons},{s.heads_from_keypoints},"
                  f"{s.heads_estimated},{len(r.associations)}\n")
        if n <= args.trace_first or n % args.every == 0:
            print(f"[frame {n}] tracked persons={tracked} pose persons={s.pose_persons} "
                  f"heads confirmed={s.heads_from_keypoints} estimated={s.heads_estimated} "
                  f"matched={len(r.associations)}")

        # Whole-run totals (the stage's own summary resets every --every).
        totals["frames"] = n
        totals["pose"] += s.pose_persons
        totals["faces"] += s.with_face_keypoints
        totals["rejected"] += s.rejected
        totals["confirmed"] += s.heads_from_keypoints
        totals["estimated"] += s.heads_estimated
        totals["matched"] += len(r.associations)
        totals["unmatched"] += len(r.unmatched_heads)
        totals["no_head"] += len(r.persons_without_head)
        totals["ms"] += stage.last_ms
        if n % args.every == 0:
            cv2.imwrite(os.path.join(args.out, f"{base}_{n:06d}.png"), annotated)

    cap.release()
    csv.close()
    if writer is not None:
        writer.release()
    n = max(1, totals["frames"])
    print(f"\n===== whole run: {totals['frames']} frames =====")
    print(f"pose persons {totals['pose']}  (with face keypoints {totals['faces']}, "
          f"rejected {totals['rejected']})")
    print(f"heads: confirmed {totals['confirmed']}, estimated {totals['estimated']}")
    print(f"association: matched {totals['matched']}, unmatched heads {totals['unmatched']}, "
          f"tracked persons without head {totals['no_head']}")
    print(f"head stage avg {totals['ms'] / n:.0f} ms/frame, stage failures {stage.failures}")
    if not saved_head_frame:
        print("No frame produced any head.")
    print(f"Per-frame table: {csv_path}")
    print(f"Output in {args.out}/")
    return 0


def _process(pipeline, stage, frame):
    """Run one frame through the app's pipeline + head stage; return it annotated."""
    clean = frame.copy()          # head model must see the frame without overlays
    pipeline.process(frame)       # existing person detection + ByteTrack + drawing
    stage.process(clean, frame, pipeline.last_detections)
    return frame


if __name__ == "__main__":
    sys.exit(main())
