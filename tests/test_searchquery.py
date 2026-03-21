from searchquery import SearchQuery, SearchResult


def test_combination_count_requires_all_dimensions():
    query = SearchQuery()
    query.set_promittor_ids([1, 2])
    query.set_significator_ids([10])
    query.set_techniques([SearchQuery.TECHNIQUE_TRANSITS])

    assert query.get_combination_count() == 0


def test_combination_count_multiplies_all_selected_dimensions():
    query = SearchQuery()
    query.set_promittor_ids([1, 2])
    query.set_significator_ids([10, 11, 12])
    query.set_techniques(
        [SearchQuery.TECHNIQUE_TRANSITS, SearchQuery.TECHNIQUE_PROFECTIONS]
    )
    query.set_aspects(
        [SearchQuery.ASPECT_CONJUNCTION, SearchQuery.ASPECT_TRINE]
    )

    assert query.get_combination_count() == 24


def test_search_result_has_actions_when_any_action_is_enabled():
    result = SearchResult(
        SearchQuery.TECHNIQUE_TRANSITS,
        SearchQuery.ASPECT_CONJUNCTION,
        1,
        2,
    )
    assert result.has_actions() is False

    result.can_export_ics = True

    assert result.has_actions() is True
