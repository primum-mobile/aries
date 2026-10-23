# Copyright (C) 2026 Max Lange
# SPDX-License-Identifier: AGPL-3.0-or-later

from __future__ import annotations

from zet_zeus_import import (
	parse_zet_text_best_effort,
	parse_zeus_text_best_effort,
	records_to_v1_dicts,
)


def test_parse_zet_peron_lines():
	text = "\n".join(
		[
			"Peron, Juan;  8.10.1895;12:04:22;;Lobos, Argentina;35s11;59w06;M;* Argentine politician.",
			"Peron, Evita;  7.05.1919;  8:56:51;;Buenos Aires, Argentina;34s36;58w27;F;* First Lady.",
			"Mirror RH;11.03.1872;15:11:53;;Buenos Aires, Argentina;34s36;58w27;F;* partnership mirror.",
		]
	)
	parsed = parse_zet_text_best_effort(text)
	assert not parsed["errors"]
	assert len(parsed["records"]) == 3
	juan = parsed["records"][0]
	assert juan["name"] == "Peron, Juan"
	assert (juan["day"], juan["month"], juan["year"]) == (8, 10, 1895)
	assert (juan["hour"], juan["minute"], juan["second"]) == (12, 4, 22)
	assert round(juan["lat"], 4) == round(-(35 + 11 / 60.0), 4)
	assert round(juan["lon"], 4) == round(-(59 + 6 / 60.0), 4)
	assert juan["male"] is True
	assert juan["zt"] == "lmt"
	mirror = parsed["records"][2]
	assert mirror["name"] == "Mirror RH"
	assert (mirror["day"], mirror["month"], mirror["year"]) == (11, 3, 1872)


def test_parse_zet_timezone_offset_field():
	line = (
		"Sample radix; 10.09.1978; 18:15; +5; "
		"Sample City, Region, Russia; 54N44; 55E56; M; fixture note;"
	)
	parsed = parse_zet_text_best_effort(line)
	assert not parsed["errors"]
	record = parsed["records"][0]
	assert record["name"] == "Sample radix"
	assert (record["hour"], record["minute"]) == (18, 15)
	assert record["tz"] == "+05:00"
	assert record["zt"] == "zone"
	assert record["place"].startswith("Sample City")
	assert round(record["lat"], 4) == round(54 + 44 / 60.0, 4)
	assert round(record["lon"], 4) == round(55 + 56 / 60.0, 4)


def test_parse_zet_hms_timezone_and_event_markers():
	line = (
		"Sample historical; 15.12.1896; 12:00; +3:43:44; "
		"Sample City, Russia; 54n44; 55e56; —; fixture;"
	)
	parsed = parse_zet_text_best_effort(line)
	assert not parsed["errors"]
	record = parsed["records"][0]
	assert record["tz"] == "+03:44"
	assert record["zt"] == "zone"
	assert record["male"] is None

	line_minsk = (
		"Sample Minsk; 19.12.1913; 12:00; +1:50; "
		"Minsk, Belarus; 53n54; 27e34; M; fixture;"
	)
	parsed_minsk = parse_zet_text_best_effort(line_minsk)
	assert not parsed_minsk["errors"]
	assert parsed_minsk["records"][0]["tz"] == "+01:50"

	line_dms = (
		"Sample event; 12.03.2026; 9:34; +1; Braine; "
		"50°41'29\"N; 4°22'22\"E; —; ;"
	)
	parsed_dms = parse_zet_text_best_effort(line_dms)
	assert not parsed_dms["errors"]
	assert round(parsed_dms["records"][0]["lat"], 4) == round(50 + 41 / 60 + 29 / 3600, 4)


def test_parse_zeus_spain_lines():
	text = "\n".join(
		[
			"Spain national chart (Madrid 1975);0;22.11.1975;12:44:16;+01:00:00;Madrid, Spain;N40.24.00;W003.41.00;-;A;;Post-Franco constitution;;;0;",
			"Madrid train bombings (Atocha first blast);3;11.03.2004;07:37:47;+01:00:00;Madrid, Spain;N40.24.00;W003.41.00;-;A;;Surveillance PDF;;2800867;1;",
		]
	)
	parsed = parse_zeus_text_best_effort(text)
	assert not parsed["errors"]
	assert len(parsed["records"]) == 2
	spain = parsed["records"][0]
	assert spain["name"].startswith("Spain national chart")
	assert spain["tz"] == "+01:00"
	assert round(spain["lat"], 4) == round(40 + 24 / 60.0, 4)
	assert round(spain["lon"], 4) == round(-(3 + 41 / 60.0), 4)
	v1 = records_to_v1_dicts([spain])[0]
	assert v1["date"] == "1975-11-22"
	assert v1["time"] == "12:44:16"
