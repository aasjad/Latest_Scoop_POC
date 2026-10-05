"""
head_drawing.py
===============

On-screen overlays for the head feature: head boxes, head points, the
optional link line from each head to its person, and (debug) the raw pose
keypoints the heads were derived from.

Why a separate module
---------------------
drawing.py draws the existing person boxes, trails and HUD, and is left
completely untouched. Keeping the head overlays here means the head feature
can be removed, or drawn differently, without editing any existing drawing
code. It REUSES drawing.color_for_id (import only), so a head is drawn in the
same colour as its person's box and the pairing is obvious at a glance.

Input / output
--------------
Input:  the display frame (drawn on in place) and an AssociationResult;
        for the debug overlay, the detector's raw PosePerson list.
Output: nothing returned; pixels on the frame.

Debug layering (draw_pose_keypoints first, then draw_associations), so that
by eye you can tell which stage is wrong:
    keypoints themselves misplaced         -> the pose MODEL is the problem
    keypoints right, head box wrong        -> the head GEOMETRY is the problem
    head box right, wrong "head ID n"/link -> ASSOCIATION is the problem

Where it fits
-------------
Called by head_stage.py AFTER the existing pipeline has drawn its person boxes
and counting line, so head overlays sit on top and never hide anything the
existing UI drew underneath. Only called when head_config HEAD_DRAW is True.

Future use
----------
Other per-person add-ons (pose skeletons, face names, Re-ID labels) can follow
the same pattern: their own *_drawing.py, called from their own stage.
"""

import cv2

import config
from . import head_config
from .drawing import FONT, color_for_id
from .head_detector import FACE_KEYPOINTS, LEFT_SHOULDER, RIGHT_SHOULDER
from .person_head_association import AssociationResult

# Short on-screen labels for the raw keypoints (full names are too wide for a
# 30 px face). l/r are the PERSON's left/right, as COCO defines them - so on
# someone facing the camera, "le" appears on the image's right.
_KP_LABELS = {0: "n", 1: "le", 2: "re", 3: "lE", 4: "rE", 5: "lS", 6: "rS"}
_KP_COLORS = {0: (0, 0, 255),                       # nose: red
              1: (255, 255, 0), 2: (255, 255, 0),   # eyes: cyan
              3: (255, 0, 255), 4: (255, 0, 255),   # ears: magenta
              5: (0, 255, 255), 6: (0, 255, 255)}   # shoulders: yellow
_POSE_BOX_COLOR = (255, 255, 255)                   # raw pose body box: white


def draw_associations(frame, result: AssociationResult):
    """Draw every head in the result: matched ones in their person's colour,
    unmatched ones in a neutral grey.

    Parameters:
        frame:  BGR display frame, modified in place.
        result: the AssociationResult for this frame.
    """
    draw_link = head_config.get("HEAD_DRAW_LINK")

    for assoc in result.associations:
        # Exactly the colour drawing.draw_detection used for this person's
        # box: the per-ID colour when tracked, plain BOX_COLOR in detect mode
        # (no ID). Matching colours are what make the pairing readable.
        color = (color_for_id(assoc.track_id) if assoc.track_id is not None
                 else config.BOX_COLOR)

        if draw_link:
            # Line from the head point to the person's box centre: makes the
            # association itself visible, the quickest way to spot a wrong
            # pairing when two people overlap. Drawn first so the head marker
            # sits on top of it.
            cv2.line(frame, assoc.head_point, assoc.person.centroid, color,
                     _scale(frame), cv2.LINE_AA)

        # "head ID 17" names the track the head was attached to, so the
        # pairing can be read directly, not just inferred from colours.
        label = (f"head ID {assoc.track_id}" if assoc.track_id is not None
                 else "head")
        _draw_head(frame, assoc.head, color, label)

    for head in result.unmatched_heads:
        # "?" = a head was found but no tracked person fits it (e.g. the
        # person model or ByteTrack has no confirmed track there this frame).
        _draw_head(frame, head, head_config.get("HEAD_UNMATCHED_COLOR"), "head ?")


def draw_pose_keypoints(frame, pose_persons, min_kp_conf: float):
    """DEBUG: draw the raw pose model output, before any head geometry.

    Parameters:
        frame:        display frame, modified in place.
        pose_persons: HeadDetector.last_pose_persons for this frame.
        min_kp_conf:  HEAD_KEYPOINT_CONF, to show which points were usable.

    Per pose person: a thin white body box with its confidence, and the nose,
    eyes, ears and shoulders. A keypoint drawn FILLED was used (conf >=
    min_kp_conf); HOLLOW means the model placed it but too unsure to use.
    Points the model could not place at all, (0, 0), are not drawn. If the
    person produced no head, the reject reason is printed under the box.
    """
    s = _scale(frame)
    for person in pose_persons:
        x1, y1, x2, y2 = person.box
        cv2.rectangle(frame, (x1, y1), (x2, y2), _POSE_BOX_COLOR, max(1, s // 2))
        _outlined_text(frame, f"pose {person.confidence:.2f}", (x1, y2 + 12 * s),
                       _POSE_BOX_COLOR, s)

        for k in FACE_KEYPOINTS + [LEFT_SHOULDER, RIGHT_SHOULDER]:
            x, y = person.keypoints[k]
            if x == 0 and y == 0:
                continue     # model could not place it - nothing to show
            point = (int(x), int(y))
            used = person.keypoint_conf[k] >= min_kp_conf
            # Filled = used for the head box; hollow = below the threshold.
            cv2.circle(frame, point, 3 * s, _KP_COLORS[k], -1 if used else s)
            # Labels only on the five face points; the shoulders are
            # recognisable by colour and labelling them crowds the face.
            if k in FACE_KEYPOINTS:
                cv2.putText(frame, _KP_LABELS[k], (point[0] + 3 * s, point[1] - 3 * s),
                            FONT, 0.3 * s, _KP_COLORS[k], max(1, s // 2), cv2.LINE_AA)

        if person.head is None and person.reject_reason:
            _outlined_text(frame, f"no head: {person.reject_reason}",
                           (x1, y2 + 26 * s), (0, 0, 255), s)

        # DIAGNOSTIC FALLBACK, never used as a head: a point at the top-centre
        # of the raw pose box (10% of its height down). Pure box geometry, no
        # keypoints. If this orange "x" appears on a person but no head point
        # does, the pose model DID find the body and the loss is in keypoint
        # processing / head-box generation; if neither appears, the pose model
        # did not find the body at all.
        fallback = ((x1 + x2) // 2, int(y1 + 0.10 * (y2 - y1)))
        cv2.drawMarker(frame, fallback, (0, 128, 255), cv2.MARKER_TILTED_CROSS,
                       8 * s, max(1, s // 2))


def draw_raw_heads(frame, heads):
    """DEBUG (temporary): a red box and red circle around EVERY head the
    detector returned, matched to a person or not.

    Drawn independently of association and of HEAD_DRAW, straight from the
    detector's output list, so if a head exists at all it is visible - this
    separates "no head was generated" from "a head was generated but the
    normal overlay did not show it".
    """
    s = _scale(frame)
    red = (0, 0, 255)
    for head in heads:
        cv2.rectangle(frame, (head.x1, head.y1), (head.x2, head.y2), red, 2 * s)
        radius = max(6 * s, int(0.6 * max(head.width, head.height)))
        cv2.circle(frame, head.head_point, radius, red, 2 * s)
        cv2.circle(frame, head.head_point, 3 * s, red, -1)


def _draw_head(frame, head, color, label: str):
    """Draw one head: box, head point and a small label.

    Parameters:
        frame: display frame, modified in place.
        head:  the HeadDetection.
        color: BGR colour (the person's colour if matched, grey otherwise).
        label: short text drawn beside the head box.

    An ESTIMATED head region (no facial keypoint seen) is drawn with a thinner
    box, a hollow point and an "est." label, so it is never mistaken for a
    confirmed head.

    Design choices, for legibility (sizes are for a 640x480 frame and grow
    with the frame - see _scale()):
        * 2 px box, the same weight as the person box, so it survives the
          window being scaled; it is told apart by being small and labelled.
        * The head point is a filled dot inside a black ring, so it reads as
          a different marker from the plain solid foot-point dot used for
          counting.
        * The label sits to the RIGHT of the head box, because the space
          above it is where drawing.draw_detection puts the "ID n" label.
    """
    s = _scale(frame)
    estimated = getattr(head, "estimated", False)
    cv2.rectangle(frame, (head.x1, head.y1), (head.x2, head.y2), color,
                  s if estimated else 2 * s)
    cv2.circle(frame, head.head_point, 6 * s, (0, 0, 0), 2 * s)
    cv2.circle(frame, head.head_point, 4 * s, color, s if estimated else -1)
    _outlined_text(frame, f"est. {label}" if estimated else label,
                   (head.x2 + 4 * s, head.y1 + 12 * s), color, s)


def _scale(frame) -> int:
    """Integer size multiplier for overlays: 1 up to a 640x480 frame, larger
    beyond it.

    Why: every size here is in frame pixels, but the window shrinks a large
    frame to fit. On a 1086x1448 photo shown at ~540 px tall, a 4 px head dot
    became ~1.5 px on screen - effectively invisible, which reads as "no head
    point" even though the head was detected. Scaling with the frame's shorter
    side keeps the overlay the same size on screen.
    """
    return max(1, round(min(frame.shape[:2]) / 480))


def _outlined_text(frame, text: str, org, color, s: int = 1):
    """Coloured text over a black outline, readable on any background.
    `s` is the _scale() multiplier."""
    cv2.putText(frame, text, org, FONT, 0.4 * s, (0, 0, 0), 3 * s, cv2.LINE_AA)
    cv2.putText(frame, text, org, FONT, 0.4 * s, color, s, cv2.LINE_AA)
