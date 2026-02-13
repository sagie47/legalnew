from normalize import normalize_document


def test_normalize_removes_repeated_headers_footers():
    extracted = {
        'file_path': '/tmp/x.pdf',
        'pages': [
            {'page_number': 1, 'text': 'HEADER\nBody A\nFOOTER', 'figures': []},
            {'page_number': 2, 'text': 'HEADER\nBody B\nFOOTER', 'figures': []},
            {'page_number': 3, 'text': 'HEADER\nBody C\nFOOTER', 'figures': []},
        ],
        'warnings': [],
    }
    out = normalize_document(extracted)
    assert 'HEADER' not in out['full_text']
    assert 'FOOTER' not in out['full_text']
    assert 'Body A' in out['full_text']
