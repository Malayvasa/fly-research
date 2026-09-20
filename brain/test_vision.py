from pathlib import Path

import numpy as np
import pytest

from .backend import Brain, SHAPE, load_model_class


@pytest.mark.skipif(not Path('.cache/fly64/fly64/model.py').exists(), reason='External Fly64 checkout required')
def test_previews_follow_effective_input_in_blank_and_frozen_modes():
    model_class = load_model_class(Path('.cache/fly64'))
    bright = np.full(SHAPE, 255, np.uint8)
    black = np.zeros(SHAPE, np.uint8)
    blank = Brain(model_class, Path('.cache/malecns'), True, 64, 'blank')
    blank.step(bright)
    assert not blank.eye_preview().any()
    frozen = Brain(model_class, Path('.cache/malecns'), True, 64, 'frozen')
    frozen.step(bright)
    first = frozen.eye_preview().copy()
    assert first.shape == (128, 256, 3) and first.max() == 255
    assert not first[0, 0].any(), 'outside the eye field stays masked'
    frozen.step(black)
    np.testing.assert_array_equal(frozen.eye_preview(), first)
    live = Brain(model_class, Path('.cache/malecns'), True, 64, 'live')
    live.step(bright)
    np.testing.assert_array_equal(live.eye_preview(), first)
    live.step(black)
    assert not live.eye_preview().any()
