from workspace_model import WorkspaceState


def test_open_document_clamps_negative_indent_and_activates_new_document():
    state = WorkspaceState()

    document = state.open_document("chart", "Natal", indent_level=-3)

    assert document.indent_level == 0
    assert state.active_document_id() == document.document_id


def test_close_active_document_moves_focus_to_next_document():
    state = WorkspaceState()
    first = state.open_document("chart", "First")
    second = state.open_document("chart", "Second")
    third = state.open_document("chart", "Third")

    state.activate_document(second.document_id)
    active_after_close = state.close_document(second.document_id)

    assert active_after_close == third.document_id
    assert state.active_document_id() == third.document_id
    assert [doc.document_id for doc in state.documents()] == [
        first.document_id,
        third.document_id,
    ]


def test_move_document_moves_family_block_before_target_sibling():
    state = WorkspaceState()
    parent_a = state.open_document("chart", "A")
    child_a1 = state.open_document("chart", "A.1", indent_level=1)
    child_a2 = state.open_document("chart", "A.2", indent_level=1)
    parent_b = state.open_document("chart", "B")
    parent_c = state.open_document("chart", "C")

    moved = state.move_document(parent_c.document_id, parent_b.document_id)

    assert moved is True
    assert [doc.title for doc in state.documents()] == [
        parent_a.title,
        child_a1.title,
        child_a2.title,
        parent_c.title,
        parent_b.title,
    ]


def test_move_document_rejects_cross_indent_targets():
    state = WorkspaceState()
    parent_a = state.open_document("chart", "A")
    child_a1 = state.open_document("chart", "A.1", indent_level=1)
    parent_b = state.open_document("chart", "B")

    moved = state.move_document(child_a1.document_id, parent_b.document_id)

    assert moved is False
