"""
head_detector.py
================

Finds HEADS in a frame. A new, independent capability - it does not touch the
existing person detector, the tracker, or counting.

Purpose / why it exists
-----------------------
The existing model (yolov8n.pt, trained on COCO) knows "person" but has no
"head" class, so it cannot tell us where anyone's head is. This module runs a
SEPARATE model to get head boxes, which person_head_association.py then attaches
to the tracked people.

It solves one problem only: "where are the heads in this frame?" It knows
nothing about track IDs, counting lines or which person a head belongs to.

Two interchangeable backends (chosen by head_config "HEAD_BACKEND")
-------------------------------------------------------------------
    "pose"  Official Ultralytics pose model (yolov8n-pose.pt, auto-download).
            It predicts 17 body keypoints per person; the first five are the
            face: nose, left eye, right eye, left ear, right ear. A head box is
            derived from those (plus the shoulders) - see head_from_pose().
            + works out of the box, no extra files
            - needs the person's body to be found by the pose model at all;
              weak in dense crowds and for very small / heavily occluded people

    "yolo"  Any Ultralytics YOLO DETECTION model trained with a "head" class
            (e.g. on SCUT-HEAD / CrowdHuman). You supply the weights.
            + sees heads directly, including backs of heads and crowds
            - you must obtain or train the model

Both return the same HeadDetection objects, so nothing downstream cares which
backend produced them.

The pose path, step by step (each step is inspectable for debugging)
--------------------------------------------------------------------
    frame
      ↓  HeadDetector._run_pose()      one pose inference
    list[PosePerson]                   raw: body box, conf, 17 keypoints + confs
      ↓  head_from_pose()  (pure)      keypoints -> head box, or a reject reason
    HeadDetection | None               stored on PosePerson.head / .reject_reason
      ↓  suppress_duplicate_heads()    one head per physical head
    list[HeadDetection]                returned to head_stage.py

After every detect() call the detector keeps:
    self.last_pose_persons  - the raw PosePerson list (for drawing keypoints)
    self.last_stats         - HeadFrameStats counters for this frame
so head_stage.py can show WHERE heads are lost: in the pose model (no pose
persons), in head-box generation (rejected keypoint sets), or later in
association.

Confirmed vs estimated heads
----------------------------
A head built from face keypoints (eyes / ears / nose) is a CONFIRMED head: the
model actually saw facial features there. If no face keypoint is usable (back
of the head, face occluded), and HEAD_ESTIMATE_WHEN_NO_FACE is on, a head
REGION is ESTIMATED from the shoulders or the top of the pose body box. Those
carry `estimated=True`, a low confidence, and are drawn and counted separately -
they are a guess at where a head should be, not a detection.

Input / output
--------------
Input:  one BGR frame (numpy array), ideally a CLEAN copy with no overlays.
Output: list[HeadDetection] in original frame pixel coordinates.

Where it fits in the pipeline
-----------------------------
    frame ──► PersonDetector.track() ──► counting        (existing, untouched)
      └─(copy)─► HeadDetector.detect() ──► PersonHeadAssociator.associate()

Communicates with: head_config.py (settings), head_stage.py (its only caller).
It loads its OWN YOLO instance, so the person model and its ByteTrack state are
never shared with or disturbed by head inference.

Future use
----------
Head boxes are the natural input for face recognition (crop the head),
head-based counting on overhead cameras, crowd density, and head-pose /
attention estimation.
"""

from dataclasses import dataclass, field

import numpy as np
from ultralytics import YOLO

import config
from . import head_config


# COCO keypoint indices, in the order the pose model outputs them.
NOSE, LEFT_EYE, RIGHT_EYE, LEFT_EAR, RIGHT_EAR = 0, 1, 2, 3, 4
LEFT_SHOULDER, RIGHT_SHOULDER = 5, 6
FACE_KEYPOINTS = [NOSE, LEFT_EYE, RIGHT_EYE, LEFT_EAR, RIGHT_EAR]
_EYE_KEYPOINTS = [LEFT_EYE, RIGHT_EYE]
_EAR_KEYPOINTS = [LEFT_EAR, RIGHT_EAR]
# Shoulders are body keypoints, but they give an independent head-size check:
# the eye-to-shoulder drop is about the same as the eye-to-crown distance.
_SHOULDER_KEYPOINTS = [LEFT_SHOULDER, RIGHT_SHOULDER]

# Names used in debug output, indexed by keypoint number.
KEYPOINT_NAMES = {NOSE: "nose", LEFT_EYE: "left_eye", RIGHT_EYE: "right_eye",
                  LEFT_EAR: "left_ear", RIGHT_EAR: "right_ear",
                  LEFT_SHOULDER: "left_shoulder", RIGHT_SHOULDER: "right_shoulder"}

# Confidence multiplier for ESTIMATED head regions, so they always rank below
# real keypoint-based heads (duplicate suppression and any later consumer can
# rely on that ordering).
_ESTIMATE_CONF_FACTOR = 0.3


@dataclass
class HeadDetection:
    """One head found in one frame.

    Responsibility: a plain-data description of a head box, deliberately
    mirroring detector.Detection so both kinds of box are handled the same
    way. Holds no model tensors, so callers never need to know what
    ultralytics returned.

    State:  box corners in frame pixels, a confidence, which backend made it,
            how it was derived, and whether it is only an estimate.
    Output: convenience geometry (center, size, head_point) used by the
            association logic and by drawing.
    """

    x1: int          # left edge, pixels
    y1: int          # top edge (y grows DOWNWARDS in image coordinates)
    x2: int          # right edge
    y2: int          # bottom edge
    confidence: float
    source: str      # "pose" or "yolo" - which backend produced it
    # Body box of the pose skeleton this head was derived from ("pose" backend
    # only; None for "yolo"). Tells association WHICH body the head grew out of.
    body_box: tuple[int, int, int, int] | None = None
    # How the box was derived: "ears" / "eyes" / "nose" (face keypoints seen),
    # "shoulders" / "body_box" (estimated), or "model" (yolo head detector).
    method: str = "model"
    # True = a guessed head REGION (no facial keypoint was seen), not a
    # confirmed head detection. Drawn and counted separately.
    estimated: bool = False

    @property
    def center(self) -> tuple[int, int]:
        """Middle of the head box. This is what association compares against
        person boxes, because a single point is easy to reason about."""
        return (self.x1 + self.x2) // 2, (self.y1 + self.y2) // 2

    @property
    def head_point(self) -> tuple[int, int]:
        """The single point that represents this head to the rest of the system.

        Defined as the box centre. It is a separate name from `center` on
        purpose: if a future feature wants a different anchor (e.g. top of the
        head for overhead counting), only this property has to change.

        NOTE: this point is NOT used for IN/OUT counting. Counting still uses
        Detection.foot_point, unchanged.
        """
        return self.center

    @property
    def width(self) -> int:
        return self.x2 - self.x1

    @property
    def height(self) -> int:
        return self.y2 - self.y1


@dataclass
class PosePerson:
    """The RAW output of the pose model for one person, before any head logic.

    Responsibility: keep exactly what the model said - body box, confidence,
    keypoint coordinates and confidences - so it can be printed and drawn for
    debugging, and so head_from_pose() can be unit-tested on synthetic data.

    State:  box (frame pixels), confidence, keypoints (17, 2) in frame pixels,
            keypoint_conf (17,). Filled in afterwards by the detector:
            head (the derived HeadDetection, or None) and reject_reason (why no
            head was produced, or None).
    """

    box: tuple[int, int, int, int]
    confidence: float
    keypoints: np.ndarray        # (17, 2) x, y in ORIGINAL frame pixels
    keypoint_conf: np.ndarray    # (17,) 0..1; all 1.0 if the model gives none
    head: HeadDetection | None = None
    reject_reason: str | None = None

    def is_visible(self, k: int, min_conf: float) -> bool:
        """True if keypoint k is confident enough AND was actually placed.

        Ultralytics reports a keypoint it could not place as (0, 0) - BOTH
        coordinates zero - so only that exact point is treated as missing.
        (An earlier `x > 0 and y > 0` test also discarded real keypoints
        lying on the frame's left or top edge, e.g. the ear of someone cut
        off at x=0.) Some ultralytics versions also zero the coordinates of
        keypoints below 0.5 confidence, which this check catches too.
        """
        x, y = self.keypoints[k]
        placed = not (x == 0 and y == 0)
        return bool(self.keypoint_conf[k] >= min_conf and placed)


@dataclass
class HeadFrameStats:
    """Counters for ONE detect() call - where heads were found or lost.

    pose_persons        bodies the pose model returned (above HEAD_CONF_THRESHOLD)
    with_face_keypoints bodies with at least one usable face keypoint
    rejected            bodies that produced no head at all
    heads_from_keypoints confirmed heads (built from face keypoints)
    heads_estimated     estimated head regions (no face keypoint seen)
    duplicates_removed  heads dropped as duplicates of another head
    reject_reasons      reason -> count, for the rejected bodies
    """

    pose_persons: int = 0
    # Debug mode only: bodies the model found below HEAD_CONF_THRESHOLD.
    below_conf_threshold: int = 0
    with_face_keypoints: int = 0
    rejected: int = 0
    heads_from_keypoints: int = 0
    heads_estimated: int = 0
    duplicates_removed: int = 0
    reject_reasons: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Keypoints -> head box   (pure function: no model, no frame - unit-testable)
# ---------------------------------------------------------------------------

def head_from_pose(person: PosePerson, frame_shape: tuple,
                   min_kp_conf: float,
                   allow_estimate: bool,
                   min_estimate_conf: float = 0.0) -> tuple[HeadDetection | None, str | None]:
    """Derive a head box for one pose person.

    Parameters:
        person:         raw PosePerson.
        frame_shape:    frame.shape, used to clip the box to the image.
        min_kp_conf:    a keypoint counts as visible at or above this conf.
        allow_estimate: if no face keypoint is visible, estimate a head region
                        from the shoulders / body box instead of rejecting.
        min_estimate_conf: ...but only if the pose BODY is at least this
                        confident. A low-confidence body with no face at all
                        is usually not a person (seen on a traffic clip: a
                        car and trees at pose conf 0.28-0.34 got "heads").

    Returns:
        (HeadDetection, None) on success, or (None, reason) on rejection.

    Geometry (why not "a box around the face keypoints"): the nose, eyes and
    ears sit on the FRONT and MIDDLE of the head. On this project's camera a
    box around them was a third too small and centred on the cheek; in a side
    view the points nearly coincide and say nothing about size. So the head
    is built from body PROPORTIONS, anchored on keypoints:

        EYE LEVEL  = mean y of the visible eyes and ears (they sit at about
                     the same height, roughly mid-head). The nose is excluded:
                     it is lower and would drag the head down.
        UP         = eye level -> crown distance. Primary estimate: the pose
                     box TOP (the head is the top-most part of an upright
                     person). Cross-check: the eye -> shoulder drop is about
                     the same length; if the two disagree wildly (e.g. raised
                     arms push the box top up), the shoulder value wins.
        HEIGHT     = 1.6 x UP (crown -> chin);  WIDTH = 0.8 x HEIGHT
        CENTRE X   = both ears -> midpoint of the ears (skull centre)
                     one ear   -> the ear, nudged 1/4 of the way to the eyes
                                  (side view: ear is near mid-skull)
                     no ears   -> midpoint of the eyes (frontal)
        CENTRE Y   = crown + HEIGHT/2 = eye level - 0.2 x UP

    Partial faces, in order of preference:
        any eye or ear visible -> confirmed head ("ears" / "eyes")
        only the nose visible  -> confirmed head ("nose"): the nose tip sits
                                  ~0.3 x UP below eye level, which fixes eye
                                  level; centre x = nose x
        no face keypoint       -> estimated region if allow_estimate
                                  ("shoulders", else "body_box"), or rejected
    """
    def vis(k):
        return person.is_visible(k, min_kp_conf)

    pts = person.keypoints
    bx1, by1, bx2, by2 = person.box
    frame_h, frame_w = frame_shape[:2]

    eyes = [k for k in _EYE_KEYPOINTS if vis(k)]
    ears = [k for k in _EAR_KEYPOINTS if vis(k)]
    shoulders = [k for k in _SHOULDER_KEYPOINTS if vis(k)]
    face_used = [k for k in FACE_KEYPOINTS if vis(k)]
    estimated = False

    if eyes or ears:
        # ---- Confirmed head from eyes / ears ------------------------------
        method = "ears" if ears else "eyes"
        eye_y = float(pts[eyes + ears, 1].mean())
        up = eye_y - by1
        if len(ears) == 2:
            cx = float(pts[ears, 0].mean())
        elif len(ears) == 1:
            ear_x = float(pts[ears[0], 0])
            eyes_x = float(pts[eyes, 0].mean()) if eyes else ear_x
            cx = ear_x + 0.25 * (eyes_x - ear_x)
        else:
            cx = float(pts[eyes, 0].mean())

    elif vis(NOSE):
        # ---- Confirmed head from the nose alone ---------------------------
        # nose_y = eye_y + 0.3*up and up = eye_y - box_top
        #   =>  up = (nose_y - box_top) / 1.3
        method = "nose"
        nose_x, nose_y = float(pts[NOSE, 0]), float(pts[NOSE, 1])
        up = (nose_y - by1) / 1.3
        eye_y = nose_y - 0.3 * up
        cx = nose_x

    elif allow_estimate and person.confidence < min_estimate_conf:
        # No face, and the body itself is doubtful: an estimate here would be
        # a guessed head on what is most likely not a person.
        return None, (f"no face keypoints; pose conf {person.confidence:.2f} "
                      f"< HEAD_ESTIMATE_MIN_POSE_CONF {min_estimate_conf}")

    elif allow_estimate:
        # ---- Estimated region: no facial feature was seen -----------------
        estimated = True
        if shoulders:
            # Crown -> eye ~= eye -> shoulder, so the shoulders sit about
            # 2 x UP below the box top. Head is centred over the shoulders.
            method = "shoulders"
            shoulder_y = float(pts[shoulders, 1].mean())
            up = (shoulder_y - by1) / 2.0
            eye_y = by1 + up
            cx = float(pts[shoulders, 0].mean())
            shoulders = []   # already used; skip the cross-check below
        else:
            # Nothing but the body box: head at its top centre, sized from
            # the box (a quarter of its height, but never wider than ~60% of
            # its width - a seated or cropped person's box is short).
            method = "body_box"
            head_h = min(0.25 * (by2 - by1), 0.6 * (bx2 - bx1) / 0.8)
            up = head_h / 1.6
            eye_y = by1 + up
            cx = (bx1 + bx2) / 2.0
    else:
        return None, "no face keypoints"

    # Cross-check UP against the eye -> shoulder drop when the shoulders are
    # visible and really below the eyes (a bending/lying person can invert
    # them, in which case the box-top estimate is kept).
    if shoulders:
        up_from_shoulders = float(pts[shoulders, 1].mean()) - eye_y
        if up_from_shoulders > 0 and not (0.5 * up_from_shoulders <= up
                                          <= 1.8 * up_from_shoulders):
            up = up_from_shoulders

    # A degenerate estimate (eyes at the box top) must not give a 0 px box.
    up = max(up, 3.0)
    head_h = 1.6 * up
    head_w = 0.8 * head_h
    cy = eye_y - up + head_h / 2

    # Clip to the frame so drawing and cropping are always safe. Clipping is
    # in the SAME pixel space as the keypoints (original frame pixels).
    # round(), not int(): int() truncates, which shifted boxes 1 px left/up.
    x1 = int(round(max(0, cx - head_w / 2)))
    y1 = int(round(max(0, cy - head_h / 2)))
    x2 = int(round(min(frame_w - 1, cx + head_w / 2)))
    y2 = int(round(min(frame_h - 1, cy + head_h / 2)))
    if x2 <= x1 or y2 <= y1:
        return None, "head box outside frame"

    if estimated:
        confidence = person.confidence * _ESTIMATE_CONF_FACTOR
    else:
        # Body confidence weighted by how sure the model is about the face
        # points actually used.
        confidence = person.confidence * float(person.keypoint_conf[face_used].mean())

    return HeadDetection(x1, y1, x2, y2, float(confidence), "pose",
                         body_box=person.box, method=method,
                         estimated=estimated), None


def box_iou(a: tuple, b: tuple) -> float:
    """Intersection-over-union of two (x1, y1, x2, y2) boxes, from 0 to 1.

    1 = identical boxes, 0 = no overlap. Used here to remove duplicate heads,
    and by person_head_association.py to compare a head's pose body box with
    the tracked person boxes.
    """
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / float(area_a + area_b - inter)


def suppress_duplicate_heads(heads: list[HeadDetection],
                             iou_threshold: float = 0.4) -> list[HeadDetection]:
    """Keep one head per physical head.

    Why: the pose model sometimes returns TWO skeletons for one person (seen on
    this camera: a full-body and an upper-body guess for the same seated man).
    Each yields a head box in the same place; without this, one copy gets
    matched and the other shows up as a stray "unmatched" head.

    How: confirmed heads before estimated ones, then highest confidence first;
    drop any later head that overlaps an already-kept head by more than
    iou_threshold, or whose centre lies inside one (catches a small duplicate
    nested inside a larger one). So an estimated region can never displace a
    real keypoint-based head.
    """
    kept = []
    for head in sorted(heads, key=lambda h: (not h.estimated, h.confidence), reverse=True):
        box = (head.x1, head.y1, head.x2, head.y2)
        cx, cy = head.center
        duplicate = any(
            box_iou(box, (k.x1, k.y1, k.x2, k.y2)) > iou_threshold
            or (k.x1 <= cx <= k.x2 and k.y1 <= cy <= k.y2)
            for k in kept)
        if not duplicate:
            kept.append(head)
    return kept


class HeadDetector:
    """Loads the head model once and turns its output into HeadDetection objects.

    Responsibility: model loading, warm-up and per-frame inference for heads.
    Why a class: the model is expensive to load, so it is loaded once in
    __init__ and reused for every frame.

    State:  the YOLO model, which backend it is, the inference size, and -
            after each detect() - last_pose_persons and last_stats for
            debugging.
    Output: detect(frame) -> list[HeadDetection].

    Relationship: created and owned by head_stage.HeadAssociationStage, which
    wraps every call in error handling. This class itself is allowed to raise
    (e.g. a missing model file) - containing failures is the stage's job.
    """

    def __init__(self, backend: str | None = None, model_path: str | None = None,
                 inference_size: int | None = None):
        """Load and warm up the head model.

        Parameters:
            backend:        "pose" or "yolo". None = head_config HEAD_BACKEND.
            model_path:     weights file. None = head_config HEAD_MODEL_PATH.
            inference_size: square input size. None = HEAD_INFERENCE_SIZE, and
                            if that is None too, the person model's size.

        Raises:
            ValueError for an unknown backend, or if the weights do not match
            the backend (e.g. a detection model given to the "pose" backend).
            Whatever ultralytics raises if the file cannot be loaded.
        """
        self.backend = backend or head_config.get("HEAD_BACKEND")
        self.model_path = model_path or head_config.get("HEAD_MODEL_PATH")
        self.inference_size = (inference_size
                               or head_config.get("HEAD_INFERENCE_SIZE")
                               or config.INFERENCE_SIZE)
        self.last_pose_persons: list[PosePerson] = []
        self.last_stats = HeadFrameStats()

        # Reject a typo in the backend name up front, with a clear message,
        # rather than failing obscurely on the first frame.
        if self.backend not in ("pose", "yolo"):
            raise ValueError(f"HEAD_BACKEND must be 'pose' or 'yolo', got {self.backend!r}")

        print(f"Loading head model {self.model_path} (backend: {self.backend}) ...")
        # A brand-new YOLO instance, separate from PersonDetector's. This is
        # what guarantees head inference can never reset or advance the
        # person model's ByteTrack state, which lives on that other instance.
        self.model = YOLO(self.model_path)
        self._check_model_matches_backend()
        self._warm_up()
        print(f"Head model ready (task={self.model.task}, imgsz={self.inference_size}, "
              f"conf>={head_config.get('HEAD_CONF_THRESHOLD')}, "
              f"keypoint conf>={head_config.get('HEAD_KEYPOINT_CONF')}).")

    def _check_model_matches_backend(self):
        """Fail early if the weights cannot serve the chosen backend.

        A plain detection model has no keypoints, so the "pose" backend would
        silently find zero heads forever. Catching it at start-up turns that
        silent failure into one clear message.
        """
        task = getattr(self.model, "task", None)
        if self.backend == "pose" and task != "pose":
            raise ValueError(
                f"Backend 'pose' needs a pose model (e.g. yolov8n-pose.pt), "
                f"but {self.model_path} is a '{task}' model.")
        if self.backend == "yolo" and task != "detect":
            raise ValueError(
                f"Backend 'yolo' needs a detection model with a head class, "
                f"but {self.model_path} is a '{task}' model.")

    def _warm_up(self):
        """Run one throwaway inference so the slow first call happens now.

        Same reason as PersonDetector._warm_up: PyTorch's first predict() is
        seconds slower than the rest, and doing it before the window opens
        keeps that stall out of the live display loop.
        """
        blank = np.zeros((self.inference_size, self.inference_size, 3), dtype=np.uint8)
        self.model.predict(blank, imgsz=self.inference_size, verbose=False)

    def detect(self, frame) -> list[HeadDetection]:
        """Find heads in one frame.

        Parameters:
            frame: BGR image. Should be a clean copy without overlays.

        Returns:
            list[HeadDetection], possibly empty, in frame pixel coordinates.
            Also refreshes self.last_pose_persons and self.last_stats.

        Uses predict(), never track(): heads get their identity by being
        attached to an already-tracked person, so a second tracker would be
        redundant and could disagree with ByteTrack.
        """
        # Reset per-frame debug state first, so a failure part-way through
        # can never leave the previous frame's data looking current.
        self.last_pose_persons = []
        self.last_stats = HeadFrameStats()

        if self.backend == "pose":
            heads = self._detect_from_pose(frame)
        else:
            heads = self._detect_from_head_model(frame)

        # One box per physical head, whichever backend produced them.
        kept = suppress_duplicate_heads(heads)
        self.last_stats.duplicates_removed = len(heads) - len(kept)
        return kept

    # ------------------------------------------------------------------
    # Backend: dedicated head-detection model
    # ------------------------------------------------------------------
    def _detect_from_head_model(self, frame) -> list[HeadDetection]:
        """Run a YOLO model that was trained with a "head" class.

        The simplest backend: the model's boxes ARE head boxes, so this is
        only a conversion into HeadDetection objects.
        """
        results = self.model.predict(
            frame,
            # Keep only the head class, in case the model also detects other
            # things (some CrowdHuman models have "person" and "head").
            classes=[head_config.get("HEAD_CLASS_ID")],
            conf=head_config.get("HEAD_CONF_THRESHOLD"),
            imgsz=self.inference_size,
            verbose=False,
        )
        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return []

        # .xyxy is already in ORIGINAL frame pixels (ultralytics undoes the
        # letterboxing), so no rescaling is needed.
        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        heads = [HeadDetection(int(x1), int(y1), int(x2), int(y2), float(c), "yolo")
                 for (x1, y1, x2, y2), c in zip(xyxy, confs)]
        self.last_stats.heads_from_keypoints = len(heads)
        return heads

    # ------------------------------------------------------------------
    # Backend: head box derived from pose keypoints
    # ------------------------------------------------------------------
    def _run_pose(self, frame) -> list[PosePerson]:
        """One pose inference -> raw PosePerson list, nothing derived yet.

        Kept separate from head derivation so the raw model output can be
        printed and drawn on its own: if the keypoints drawn here are wrong,
        the problem is the model, not our geometry.
        """
        threshold = head_config.get("HEAD_CONF_THRESHOLD")
        # In debug mode, ask the model for weak bodies too, so a person who
        # is lost to HEAD_CONF_THRESHOLD shows up in the trace as "rejected:
        # pose conf below threshold" instead of vanishing silently inside
        # predict(). Bodies above the threshold are the same either way
        # (NMS keeps the higher-confidence box of any overlap), so normal
        # results do not change.
        debug = head_config.get("HEAD_DEBUG")
        result = self.model.predict(
            frame,
            conf=min(threshold, 0.05) if debug else threshold,
            imgsz=self.inference_size,
            verbose=False,
        )[0]
        keypoints = result.keypoints
        if keypoints is None or result.boxes is None or len(result.boxes) == 0:
            return []

        # .xy is in ORIGINAL frame pixels, like boxes.xyxy - ultralytics maps
        # both back from the letterboxed inference size. Shapes: (N, 17, 2).
        xy = keypoints.xy.cpu().numpy()
        # .conf can be None for models exported without visibility scores; in
        # that case treat every keypoint as visible (the box conf still gates).
        kp_conf = (keypoints.conf.cpu().numpy() if keypoints.conf is not None
                   else np.ones(xy.shape[:2], dtype=np.float32))
        boxes = result.boxes.xyxy.cpu().numpy()
        confs = result.boxes.conf.cpu().numpy()

        return [PosePerson(box=tuple(int(v) for v in boxes[i]),
                           confidence=float(confs[i]),
                           keypoints=xy[i], keypoint_conf=kp_conf[i])
                for i in range(len(boxes))]

    def _detect_from_pose(self, frame) -> list[HeadDetection]:
        """Pose inference, then head_from_pose() for every pose person.

        Every pose person ends up with either .head set or .reject_reason set,
        and the counters in self.last_stats record which, so a missing head
        can always be traced to its cause.
        """
        persons = self._run_pose(frame)
        self.last_pose_persons = persons
        stats = self.last_stats

        min_kp_conf = head_config.get("HEAD_KEYPOINT_CONF")
        allow_estimate = head_config.get("HEAD_ESTIMATE_WHEN_NO_FACE")
        threshold = head_config.get("HEAD_CONF_THRESHOLD")
        heads = []
        for person in persons:
            # Only present in debug mode (see _run_pose): a body the model
            # found, but below HEAD_CONF_THRESHOLD. Recorded, never used.
            if person.confidence < threshold:
                person.reject_reason = (f"pose conf {person.confidence:.2f} "
                                        f"< HEAD_CONF_THRESHOLD {threshold}")
                stats.below_conf_threshold += 1
                continue
            stats.pose_persons += 1

            if any(person.is_visible(k, min_kp_conf) for k in FACE_KEYPOINTS):
                stats.with_face_keypoints += 1

            head, reason = head_from_pose(person, frame.shape, min_kp_conf, allow_estimate,
                                          head_config.get("HEAD_ESTIMATE_MIN_POSE_CONF"))
            person.head, person.reject_reason = head, reason
            if head is None:
                stats.rejected += 1
                stats.reject_reasons[reason] = stats.reject_reasons.get(reason, 0) + 1
                continue
            if head.estimated:
                stats.heads_estimated += 1
            else:
                stats.heads_from_keypoints += 1
            heads.append(head)
        return heads
