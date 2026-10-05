"""
Unit tests for the head feature, on synthetic inputs only - no camera, no
model inference. Run from the project root:

    python -m pytest tests -q

Covers: head-box generation from keypoints, partial / insufficient keypoints,
estimated regions, missing keypoint confidences, duplicate suppression, and
person-head association (valid match, rejection, one-to-one, overlapping
people, empty inputs, pose/tracker box mismatch).

Keypoint layout used by the synthetic people (COCO order): 0 nose, 1 left eye,
2 right eye, 3 left ear, 4 right ear, 5 left shoulder, 6 right shoulder.
"""

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import person_counter  # noqa: E402,F401  (sets FFmpeg env before cv2 loads)
from person_counter.detector import Detection  # noqa: E402
from person_counter.head_detector import (  # noqa: E402
    HeadDetection, PosePerson, head_from_pose, suppress_duplicate_heads, box_iou)
from person_counter.person_head_association import PersonHeadAssociator  # noqa: E402

FRAME = (480, 640, 3)
KP_CONF = 0.2


def make_pose(box=(100, 100, 160, 300), conf=0.8, points=None, confs=None):
    """A PosePerson with only the given keypoints placed; the rest (0, 0)."""
    kps = np.zeros((17, 2), dtype=np.float32)
    kc = np.zeros(17, dtype=np.float32)
    for k, (x, y) in (points or {}).items():
        kps[k] = (x, y)
        kc[k] = (confs or {}).get(k, 0.9)
    return PosePerson(box=box, confidence=conf, keypoints=kps, keypoint_conf=kc)


# A standing person seen from the front, head ~100..148 px tall region:
# crown at box top y=100, eyes at y=125, shoulders at y=150.
FRONT = {0: (130, 132), 1: (136, 125), 2: (124, 125), 3: (142, 126), 4: (118, 126),
         5: (148, 150), 6: (112, 150)}


# ---------------------------------------------------------------------------
# head_from_pose: keypoints -> head box
# ---------------------------------------------------------------------------

def test_frontal_face_head_box_is_on_the_head():
    head, reason = head_from_pose(make_pose(points=FRONT), FRAME, KP_CONF, True)
    assert reason is None and not head.estimated and head.method == "ears"
    # up = 125 - 100 = 25 -> height 40, width 32, centre x = mid-ears = 130
    assert head.y1 == 100                       # crown at the body box top
    assert abs(head.height - 40) <= 1 and abs(head.width - 32) <= 1
    assert head.head_point[0] == 130            # horizontally between the ears
    assert 100 < head.head_point[1] < 125       # above eye level, below crown


def test_head_point_is_centre_of_derived_box_in_frame_pixels():
    head, _ = head_from_pose(make_pose(points=FRONT), FRAME, KP_CONF, True)
    assert head.head_point == ((head.x1 + head.x2) // 2, (head.y1 + head.y2) // 2)


def test_side_view_one_ear_uses_ear_not_face():
    # Only the right ear and right eye: head centre sits near the ear,
    # i.e. behind the face points, not on the cheek.
    pts = {2: (140, 125), 4: (128, 126)}
    head, _ = head_from_pose(make_pose(points=pts), FRAME, KP_CONF, True)
    assert head.method == "ears"
    assert 128 <= head.head_point[0] < 134       # ear x nudged 1/4 towards eye


def test_single_eye_is_enough():
    head, reason = head_from_pose(make_pose(points={1: (130, 125)}), FRAME, KP_CONF, True)
    assert reason is None and head.method == "eyes" and not head.estimated


def test_nose_only_gives_confirmed_head():
    head, reason = head_from_pose(make_pose(points={0: (130, 132)}), FRAME, KP_CONF, True)
    assert reason is None and head.method == "nose" and not head.estimated
    assert head.y1 <= 102 and head.head_point[0] == 130


def test_low_confidence_keypoints_are_ignored():
    confs = {k: 0.1 for k in FRONT}
    person = make_pose(points=FRONT, confs=confs)
    head, reason = head_from_pose(person, FRAME, KP_CONF, allow_estimate=False)
    assert head is None and reason == "no face keypoints"


def test_keypoint_at_origin_counts_as_missing():
    # Ultralytics reports unplaced keypoints as (0, 0) - even with high conf.
    person = make_pose(points={1: (0, 0)}, confs={1: 0.99})
    head, reason = head_from_pose(person, FRAME, KP_CONF, allow_estimate=False)
    assert head is None and reason == "no face keypoints"


def test_no_face_estimates_from_shoulders_and_is_flagged():
    pts = {5: (148, 150), 6: (112, 150)}       # back of the head: shoulders only
    head, reason = head_from_pose(make_pose(points=pts), FRAME, KP_CONF, True)
    assert reason is None and head.estimated and head.method == "shoulders"
    assert head.head_point[0] == 130 and head.y1 == 100


def test_no_keypoints_at_all_estimates_from_body_box():
    head, _ = head_from_pose(make_pose(points={}), FRAME, KP_CONF, True)
    assert head.estimated and head.method == "body_box"
    assert head.y1 == 100 and head.head_point[0] == 130


def test_estimates_have_lower_confidence_than_confirmed_heads():
    confirmed, _ = head_from_pose(make_pose(points=FRONT), FRAME, KP_CONF, True)
    estimated, _ = head_from_pose(make_pose(points={}), FRAME, KP_CONF, True)
    assert estimated.confidence < confirmed.confidence


def test_estimate_disabled_rejects():
    head, reason = head_from_pose(make_pose(points={}), FRAME, KP_CONF, False)
    assert head is None and reason == "no face keypoints"


def test_missing_keypoint_confidence_treated_as_visible():
    # Models exported without visibility scores: the detector fills 1.0.
    person = make_pose(points=FRONT)
    person.keypoint_conf = np.ones(17, dtype=np.float32)
    head, _ = head_from_pose(person, FRAME, KP_CONF, True)
    assert head is not None and not head.estimated


def test_head_box_is_clipped_to_frame():
    # Face at the right edge: the derived box would reach x=646 on a
    # 640-wide frame, so it must be clipped to the last column (639).
    pts = {k: (x + 500, y) for k, (x, y) in FRONT.items()}
    head, _ = head_from_pose(make_pose(box=(600, 100, 639, 300), points=pts), FRAME, KP_CONF, True)
    assert head.x2 == 639 and head.x1 < head.x2


def test_raised_arms_fall_back_to_shoulder_distance():
    # Box top far above the head (arms up): box says up=85, shoulders say 25.
    head, _ = head_from_pose(make_pose(box=(100, 40, 160, 300), points=FRONT),
                             FRAME, KP_CONF, True)
    assert abs(head.height - 40) <= 1


# ---------------------------------------------------------------------------
# Duplicate suppression
# ---------------------------------------------------------------------------

def test_duplicate_heads_keep_highest_confidence():
    heads = [HeadDetection(10, 10, 40, 40, 0.3, "pose"),
             HeadDetection(12, 11, 41, 42, 0.5, "pose"),
             HeadDetection(100, 10, 130, 40, 0.4, "pose")]
    assert [h.confidence for h in suppress_duplicate_heads(heads)] == [0.5, 0.4]


def test_estimated_never_displaces_confirmed():
    heads = [HeadDetection(10, 10, 40, 40, 0.2, "pose"),
             HeadDetection(10, 10, 40, 40, 0.9, "pose", estimated=True)]
    kept = suppress_duplicate_heads(heads)
    assert len(kept) == 1 and not kept[0].estimated


# ---------------------------------------------------------------------------
# Person-head association (current behaviour of person_head_association.py)
# ---------------------------------------------------------------------------

@pytest.fixture
def assoc():
    return PersonHeadAssociator(upper_region_fraction=0.45,
                                horizontal_margin=0.15, top_margin=0.10)


def test_valid_head_matches_its_person(assoc):
    p = Detection(100, 100, 200, 400, 0.9, 1)
    h = HeadDetection(130, 100, 170, 140, 0.8, "pose")
    r = assoc.associate([p], [h])
    assert r.by_track_id[1].head is h


def test_head_at_legs_is_rejected(assoc):
    p = Detection(100, 100, 200, 400, 0.9, 1)
    h = HeadDetection(130, 330, 170, 370, 0.8, "pose")
    r = assoc.associate([p], [h])
    assert not r.associations and r.unmatched_heads == [h]


def test_head_beside_person_is_rejected(assoc):
    p = Detection(100, 100, 200, 400, 0.9, 1)
    h = HeadDetection(300, 100, 340, 140, 0.8, "pose")
    assert not assoc.associate([p], [h]).associations


def test_one_to_one_matching(assoc):
    p1 = Detection(100, 100, 200, 400, 0.9, 1)
    p2 = Detection(170, 110, 270, 410, 0.9, 2)
    h1 = HeadDetection(130, 100, 170, 140, 0.8, "pose")
    h2 = HeadDetection(200, 110, 240, 150, 0.8, "pose")
    r = assoc.associate([p1, p2], [h1, h2])
    assert r.by_track_id[1].head is h1 and r.by_track_id[2].head is h2
    # no head used twice, no person given two heads
    assert len({id(a.head) for a in r.associations}) == len(r.associations) == 2


def test_single_head_two_candidates_goes_to_one_person(assoc):
    p1 = Detection(100, 100, 200, 400, 0.9, 1)
    p2 = Detection(170, 110, 270, 410, 0.9, 2)
    h = HeadDetection(175, 100, 205, 130, 0.8, "pose")       # closer to p2's centre
    r = assoc.associate([p1, p2], [h])
    assert len(r.associations) == 1 and r.associations[0].track_id == 2
    assert len(r.persons_without_head) == 1


def test_overlapping_people_resolved_by_body_box(assoc):
    front = Detection(100, 100, 220, 420, 0.9, 10)
    behind = Detection(150, 80, 230, 300, 0.9, 11)
    h = HeadDetection(150, 90, 190, 130, 0.8, "pose", body_box=(148, 82, 232, 298))
    assert assoc.associate([front, behind], [h]).associations[0].track_id == 11


def test_pose_tracker_box_mismatch_still_matches(assoc):
    # Pose body box much taller than the tracker's (real case on this camera:
    # tracker (0,96,36,247) vs pose (0,97,51,387)) - partial overlap is enough.
    tracked = Detection(0, 96, 36, 247, 0.3, 7)
    h = HeadDetection(0, 96, 32, 150, 0.5, "pose", body_box=(0, 97, 51, 387))
    assert 0 < box_iou(h.body_box, (0, 96, 36, 247)) < 0.5
    assert assoc.associate([tracked], [h]).associations[0].track_id == 7


def test_empty_inputs(assoc):
    p = Detection(100, 100, 200, 400, 0.9, 1)
    h = HeadDetection(130, 100, 170, 140, 0.8, "pose")
    assert not assoc.associate([], []).associations
    r = assoc.associate([p], [])
    assert r.persons_without_head == [p] and not r.unmatched_heads
    r = assoc.associate([], [h])
    assert r.unmatched_heads == [h]


def test_association_does_not_change_counting_fields(assoc):
    p = Detection(100, 100, 200, 400, 0.9, 1)
    before = (p.x1, p.y1, p.x2, p.y2, p.track_id, p.foot_point)
    assoc.associate([p], [HeadDetection(130, 100, 170, 140, 0.8, "pose")])
    assert (p.x1, p.y1, p.x2, p.y2, p.track_id, p.foot_point) == before


def test_no_estimate_for_low_confidence_body():
    # No face keypoints and a doubtful body (e.g. a car the pose model half
    # believes is a person): no estimated head.
    weak = make_pose(points={}, conf=0.3)
    head, reason = head_from_pose(weak, FRAME, KP_CONF, True, min_estimate_conf=0.5)
    assert head is None and "HEAD_ESTIMATE_MIN_POSE_CONF" in reason
    # A confident body without a face still gets its (flagged) estimate.
    strong = make_pose(points={}, conf=0.8)
    head, _ = head_from_pose(strong, FRAME, KP_CONF, True, min_estimate_conf=0.5)
    assert head is not None and head.estimated


def test_low_body_confidence_does_not_block_face_heads():
    # The estimate threshold must not touch keypoint-based heads.
    head, _ = head_from_pose(make_pose(points=FRONT, conf=0.25), FRAME, KP_CONF, True,
                             min_estimate_conf=0.5)
    assert head is not None and not head.estimated


def test_close_up_person_cut_off_by_frame_bottom_still_matches(assoc):
    # Real case from the live webcam: person so close that the box is cut at
    # the bottom frame edge (y=476 of 480) and holds only head + shoulders.
    person = Detection(29, 116, 554, 476, 0.9, 1)
    head = HeadDetection(161, 121, 427, 454, 0.85, "pose", body_box=(48, 121, 572, 476))
    assert head.center[1] > 116 + 0.45 * (476 - 116)   # centre below the upper region
    assert assoc.associate([person], [head]).by_track_id[1].head is head


def test_head_top_inside_box_but_centre_below_box_is_rejected(assoc):
    p = Detection(100, 100, 200, 200, 0.9, 1)
    h = HeadDetection(120, 120, 180, 420, 0.8, "pose")      # centre y=270 > box bottom
    assert not assoc.associate([p], [h]).associations
