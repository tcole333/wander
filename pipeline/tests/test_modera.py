import gzip

import numpy as np

from prebuild import modera


def test_a_climate_file_decodes_within_half_a_step_and_keeps_missing_cells():
    rng = np.random.default_rng(1816)
    frames = rng.normal(0.0, 3.0, (3, 4, 6))
    frames[1] *= 12  # a wide-range month, whose step grows past 0.1 K
    frames[0, 2, 3] = frames[2, 0, 0] = np.nan
    stored = modera.to_file(modera.quantize(frames, modera.MEAN, 1816))
    assert stored[4:8] == b"\0\0\0\0"  # gzip mtime 0
    assert gzip.decompress(stored)[:4] == b"WCY1"
    decoded = modera.from_file(stored)
    assert (decoded.variable, decoded.first_year, decoded.codes.shape) == (0, 1816, (3, 4, 6))
    assert decoded.scale[0] == np.float32(0.1) < decoded.scale[1]
    missing = np.isnan(frames)
    assert np.array_equal(decoded.codes == modera.MISSING, missing)
    error = np.abs(decoded.values() - frames)[~missing]
    half_step = np.broadcast_to(decoded.scale[:, None, None] / 2, frames.shape)[~missing]
    assert np.all(error <= half_step + 1e-6)
