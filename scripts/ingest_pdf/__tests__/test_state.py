import tempfile
from pathlib import Path

from state import load_state, mark_file, save_state


def test_state_roundtrip():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / 'state.json'
        st = load_state(str(p))
        mark_file(st, 'a.pdf', 'hash123', 'upserted', 7)
        save_state(str(p), st)

        loaded = load_state(str(p))
        assert loaded['files']['a.pdf']['chunks'] == 7
        assert loaded['files']['a.pdf']['status'] == 'upserted'
