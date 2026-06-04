from ems_simulator.main import _build_advisor


def test_build_advisor_has_24_hours_and_now():
    adv = _build_advisor(now_hour=10, forecast={"pv": []})
    assert adv["now_hour"] == 10
    assert len(adv["hours"]) == 24
    assert [h["hour"] for h in adv["hours"]] == list(range(24))
    for h in adv["hours"]:
        assert isinstance(h["price_gr"], int)
        assert isinstance(h["pv_w"], int)


def test_build_advisor_maps_pv_by_offset_from_now():
    # forecast[i] applies to hour (now_hour + i) % 24
    adv = _build_advisor(now_hour=22, forecast={"pv": [1000, 2000, 3000]})
    by_hour = {h["hour"]: h["pv_w"] for h in adv["hours"]}
    assert by_hour[22] == 1000
    assert by_hour[23] == 2000
    assert by_hour[0] == 3000     # wraps past midnight
    assert by_hour[5] == 0        # untouched hours stay 0


def test_build_advisor_handles_non_dict_forecast():
    adv = _build_advisor(now_hour=0, forecast=None)
    assert all(h["pv_w"] == 0 for h in adv["hours"])
