"""Generate a throwaway Home Assistant config for testing the card end to end.

The instance simulates Marius's Solis S6-EH3P20K-H installation with template
entities that use the *real* entity ids from demo/demo-config.js, switches
scenarios with input_select.sim_scenario, and loads the built card from
/local/sunsynk-3d/ as a Lovelace resource.

Usage (with the Home Assistant venv's python, which has PyYAML):
    python test/ha/generate_config.py <config_dir>
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
S = "solis_s6_eh3p_"

# Same numbers as demo/mock-hass.js. battery: + discharging / - charging; grid: + import / - export.
SCENARIOS: dict[str, dict] = {
    "sunny_export": dict(pv=[2100, 2000, 2600, 2500], pvV=[482, 474, 521, 515], soc=64, battery=-3000, home=1200, grid=-5000, gridV=231, status=3,
                         parter=800, etaj=3, tv=110, lumini=4.2, today=dict(pv=19.9, load=4.7, imp=0.4, exp=6.2, chg=13.0, dis=5.1)),
    "evening_discharge": dict(pv=[120, 110, 40, 35], pvV=[310, 300, 210, 205], soc=48, battery=2250, home=2550, grid=40, gridV=229, status=3,
                              parter=1200, etaj=650, tv=115, lumini=85, today=dict(pv=24.1, load=11.2, imp=0.6, exp=6.9, chg=13.4, dis=7.8)),
    "night_grid_charge": dict(pv=[0, 0, 0, 0], pvV=[3, 2, 3, 4], soc=31, battery=-4000, home=760, grid=4790, gridV=232, status=3,
                              parter=3, etaj=3, tv=0, lumini=12, today=dict(pv=0, load=1.1, imp=3.9, exp=0, chg=3.2, dis=0.4)),
    "grid_outage": dict(pv=[900, 850, 700, 650], pvV=[455, 450, 470, 468], soc=72, battery=450, home=3500, grid=0, gridV=0, status=3,
                        parter=1400, etaj=1100, tv=110, lumini=6, today=dict(pv=9.4, load=9.9, imp=0, exp=0, chg=2.1, dis=3.4)),
    "string_fault": dict(pv=[2300, 0, 2700, 1200], pvV=[486, 2.2, 519, 498], soc=80, battery=-1500, home=1100, grid=-3600, gridV=230, status=3,
                         parter=650, etaj=3, tv=0, lumini=4.2, today=dict(pv=14.2, load=3.9, imp=0.2, exp=4.4, chg=9.0, dis=2.2)),
    "inverter_alarm": dict(pv=[0, 0, 0, 0], pvV=[480, 475, 520, 512], soc=55, battery=0, home=650, grid=650, gridV=231, status=4100,
                           parter=3, etaj=3, tv=110, lumini=4, today=dict(pv=6.0, load=5.1, imp=2.2, exp=1.0, chg=4.0, dis=2.4)),
    # some sensors go unavailable/unknown in this one
    "unavailable": dict(pv=[2100, 2000, 2600, 2500], pvV=[482, 474, 521, 515], soc=64, battery=-3000, home=1200, grid=-5000, gridV=231, status=3,
                        parter=800, etaj=3, tv=110, lumini=4.2, today=dict(pv=19.9, load=4.7, imp=0.4, exp=6.2, chg=13.0, dis=5.1)),
}

# entities that report "unavailable" (availability false) or "unknown" in the unavailable scenario
UNAVAILABLE_IN_SCENARIO = {f"{S}pv_power_2", f"{S}battery_soc", f"{S}battery_current_direction", f"{S}a_phase_voltage", "daikin_parter_power"}
UNKNOWN_IN_SCENARIO = {"putere_retea", f"{S}today_energy_fed_into_grid"}


def table(key: str, fn=lambda v: v) -> str:
    """Jinja dict lookup of a scenario value."""
    values = {name: fn(sc) for name, sc in SCENARIOS.items()}
    return json.dumps(values)


def jit(expr: str, pct: float) -> str:
    """Add jitter (percent of |value|) when input_boolean.sim_jitter is on."""
    return f"(({expr}) * (1 + (((range(0, 1000) | random) - 500) / 500 * {pct} if is_state('input_boolean.sim_jitter', 'on') else 0)))"


def sensor(object_id: str, value_expr: str, unit: str | None, device_class: str | None = None, state_class: str | None = None,
           round_to: int = 1, jitter: float = 0.0, name: str | None = None) -> dict:
    expr = jit(value_expr, jitter) if jitter else value_expr
    state = "{% set v = " + expr + " %}{{ v | round(" + str(round_to) + ") }}"
    if object_id in UNKNOWN_IN_SCENARIO:
        state = "{% if sc == 'unavailable' %}{{ none }}{% else %}" + state + "{% endif %}"
    out = {
        "name": name or object_id.replace("_", " ").title(),
        "default_entity_id": f"sensor.{object_id}",
        "unique_id": f"sim_{object_id}",
        "state": state,
    }
    if object_id in UNAVAILABLE_IN_SCENARIO:
        out["availability"] = "{{ sc != 'unavailable' }}"
    if unit:
        out["unit_of_measurement"] = unit
    if device_class:
        out["device_class"] = device_class
    if state_class:
        out["state_class"] = state_class
    return out


def build_template_sensors() -> list[dict]:
    sc = "sc"
    look = lambda field: f"({table(field, lambda s: s[field])})[{sc}]"  # noqa: E731
    sensors: list[dict] = []
    for i in range(4):
        p = f"({table('pv', lambda s, i=i: s['pv'][i])})[{sc}]"
        v = f"({table('pvV', lambda s, i=i: s['pvV'][i])})[{sc}]"
        sensors.append(sensor(f"{S}pv_power_{i + 1}", p, "W", "power", "measurement", 0, 0.05, f"Invertor Solis PV Power {i + 1}"))
        sensors.append(sensor(f"{S}pv_voltage_{i + 1}", v, "V", "voltage", "measurement", 1, 0.01, f"Invertor Solis PV Voltage {i + 1}"))
        sensors.append(sensor(f"{S}pv_current_{i + 1}", f"(({p}) / ([({v}), 1] | max))", "A", "current", "measurement", 1, 0.0, f"Invertor Solis PV Current {i + 1}"))
    total = " + ".join(f"({table('pv', lambda s, i=i: s['pv'][i])})[{sc}]" for i in range(4))
    sensors.append(sensor(f"{S}total_pv_power", total, "W", "power", "measurement", 0, 0.03, "Invertor Solis Total PV Power"))
    today = lambda k: f"({table('today', lambda s, k=k: s['today'][k])})[{sc}]"  # noqa: E731
    sensors.append(sensor(f"{S}pv_today_energy_generation", today("pv"), "kWh", "energy", "total_increasing", 1, 0, "Invertor Solis PV Today Energy Generation"))
    sensors.append(sensor("solcast_pv_forecast_forecast_remaining_today", "7.4 if is_state('sun.sun', 'above_horizon') else 0", "kWh", "energy", None, 1, 0, "Solcast Forecast Remaining Today"))
    sensors.append(sensor("temperatura_exterioara", "13.5", "°C", "temperature", "measurement", 1, 0.02, "Temperatura exterioară"))
    bat = look("battery")
    sensors.append(sensor("solis_putere_baterie_incarcare", f"-(({bat}) | abs)", "W", "power", "measurement", 0, 0.04, "Putere baterie (card)"))
    sensors.append(sensor(f"{S}battery_power", f"({bat}) | abs", "W", "power", "measurement", 0, 0.04, "Invertor Solis Battery Power"))
    sensors.append(sensor(f"{S}battery_current_direction", f"1 if ({bat}) > 0 else 0", None, None, "measurement", 0, 0, "Invertor Solis Battery Current Direction"))
    sensors.append(sensor(f"{S}battery_soc", look("soc"), "%", "battery", "measurement", 0, 0, "Invertor Solis Battery SOC"))
    sensors.append(sensor(f"{S}battery_soh", "100", "%", None, "measurement", 0, 0, "Invertor Solis Battery SOH"))
    sensors.append(sensor(f"{S}battery_voltage", f"250 + ({look('soc')}) * 0.25", "V", "voltage", "measurement", 1, 0, "Invertor Solis Battery Voltage"))
    sensors.append(sensor(f"{S}battery_voltage_bms", "265.5", "V", "voltage", "measurement", 1, 0, "Invertor Solis Battery Voltage (BMS)"))
    sensors.append(sensor(f"{S}battery_current", f"(({bat}) | abs) / 262", "A", "current", "measurement", 1, 0, "Invertor Solis Battery Current"))
    sensors.append(sensor(f"{S}today_battery_charge_energy", today("chg"), "kWh", "energy", "total_increasing", 1, 0, "Invertor Solis Today Battery Charge Energy"))
    sensors.append(sensor(f"{S}today_battery_discharge_energy", today("dis"), "kWh", "energy", "total_increasing", 1, 0, "Invertor Solis Today Battery Discharge Energy"))
    home = look("home")
    sensors.append(sensor("consum_casa", home, "W", "power", "measurement", 0, 0.04, "Consum casă"))
    for n, k in ((1, 0.45), (2, 0.3), (3, 0.25)):
        sensors.append(sensor(f"solis_consum_faza_l{n}", f"({home}) * {k}", "W", "power", "measurement", 0, 0.04, f"Consum faza L{n}"))
    sensors.append(sensor(f"{S}backup_load_power", home, "W", "power", "measurement", 0, 0.04, "Invertor Solis Backup Load power"))
    sensors.append(sensor(f"{S}today_energy_consumption", today("load"), "kWh", "energy", "total_increasing", 1, 0, "Invertor Solis Today Energy Consumption"))
    sensors.append(sensor("putere_retea", look("grid"), "W", "power", "measurement", 0, 0.04, "Putere rețea"))
    sensors.append(sensor(f"{S}a_phase_voltage", look("gridV"), "V", "voltage", "measurement", 1, 0.003, "Invertor Solis A Phase Voltage"))
    sensors.append(sensor(f"{S}grid_frequency", f"50.01 if ({look('gridV')}) > 50 else 0", "Hz", "frequency", "measurement", 2, 0, "Invertor Solis Grid Frequency"))
    sensors.append(sensor(f"{S}today_energy_imported_from_grid", today("imp"), "kWh", "energy", "total_increasing", 1, 0, "Invertor Solis Today Energy Imported From Grid"))
    sensors.append(sensor(f"{S}today_energy_fed_into_grid", today("exp"), "kWh", "energy", "total_increasing", 1, 0, "Invertor Solis Today Energy Fed Into Grid"))
    for p, v, k in (("a", 231.3, 0.45), ("b", 227.5, 0.3), ("c", 232.6, 0.25)):
        sensors.append(sensor(f"{S}backup_ac_voltage_phase_{p}", str(v), "V", "voltage", "measurement", 1, 0.003, f"Invertor Solis Backup AC Voltage Phase {p.upper()}"))
        sensors.append(sensor(f"{S}backup_ac_current_phase_{p}", f"({home}) * {k} / 230", "A", "current", "measurement", 1, 0, f"Invertor Solis Backup AC Current Phase {p.upper()}"))
    sensors.append(sensor(f"{S}temperature", "36.5", "°C", "temperature", "measurement", 1, 0.01, "Invertor Solis Temperature"))
    sensors.append(sensor(f"{S}pv_bus_voltage", "786.1", "V", "voltage", "measurement", 1, 0, "Invertor Solis PV Bus Voltage"))
    sensors.append(sensor(f"{S}alarm_code_data", f"4100 if ({look('status')}) == 4100 else 0", None, None, "measurement", 0, 0, "Invertor Solis Alarm code data"))
    sensors.append(sensor("solis_cod_stare_card", look("status"), None, None, None, 0, 0, "Solis cod stare (card)"))
    status_string = {
        "name": "Invertor Solis Status String",
        "default_entity_id": f"sensor.{S}status_string",
        "unique_id": f"sim_{S}status_string",
        "state": "{{ 'Alarm / Grid Overvoltage' if sc == 'inverter_alarm' else 'Bypass / Inverting / Running' }}",
    }
    sensors.append(status_string)
    for oid, field, nm in (("daikin_parter_power", "parter", "Daikin Parter Power"), ("daikin_etaj_power", "etaj", "Daikin Etaj Power"),
                           ("tv_matrimonial_power", "tv", "TV Matrimonial Power"), ("lumini_estimat_power", "lumini", "Lumini (estimat) power")):
        sensors.append(sensor(oid, look(field), "W", "power", "measurement", 1, 0.04, nm))
    for oid, val, nm in (("daikin_parter_energy", 41.37, "Daikin Parter Energy"), ("daikin_etaj_energy", 28.02, "Daikin Etaj Energy"),
                         ("tv_matrimonial_energy", 12.58, "TV Matrimonial Energy"), ("lumini_estimat_energy", 3.8, "Lumini (estimat) energy")):
        sensors.append(sensor(oid, str(val), "kWh", "energy", "total_increasing", 2, 0, nm))
    sensors.append(sensor("daikin_parter_inside_temperature", "21.5", "°C", "temperature", "measurement", 1, 0.01, "Daikin Parter Temperatura interioară"))
    sensors.append(sensor("daikin_etaj_temperatura_interioara", "22.0", "°C", "temperature", "measurement", 1, 0.01, "Daikin Etaj Temperatura interioară"))
    return sensors


def build_config(config_dir: Path) -> dict:
    return {
        "homeassistant": {
            "name": "Sunsynk 3D test",
            "latitude": 44.43,
            "longitude": 26.10,
            "elevation": 80,
            "unit_system": "metric",
            "time_zone": "Europe/Bucharest",
            "country": "RO",
            "currency": "RON",
            "auth_providers": [
                {"type": "trusted_networks", "trusted_networks": ["127.0.0.1/32", "::1/128"], "allow_bypass_login": True},
                {"type": "homeassistant"},
            ],
        },
        "frontend": {},
        "api": {},
        "config": {},
        "history": {},
        "recorder": {"purge_keep_days": 2, "commit_interval": 5},
        "sun": {},
        "logger": {"default": "warning", "logs": {"homeassistant.components.template": "warning"}},
        "lovelace": {
            "mode": "yaml",
            "resources": [{"url": "/local/sunsynk-3d/sunsynk-power-flow-card-3d.js?v=dev", "type": "module"}],
        },
        "input_select": {
            "sim_scenario": {"name": "Simulated scenario", "options": list(SCENARIOS), "initial": "sunny_export", "icon": "mdi:test-tube"},
        },
        "input_boolean": {
            "sim_jitter": {"name": "Live jitter", "initial": True},
            "sim_daikin_parter": {"name": "sim Daikin Parter on", "initial": True},
            "sim_daikin_etaj": {"name": "sim Daikin Etaj on", "initial": False},
            **{f"sim_light_{k}": {"name": f"sim light {k}", "initial": k in ("balcoane", "terasa")} for k in ("matrimonial", "dormitor", "bucatarie", "balcoane", "terasa")},
        },
        "template": [
            {
                "triggers": [
                    {"trigger": "time_pattern", "seconds": "/5"},
                    {"trigger": "state", "entity_id": ["input_select.sim_scenario", "input_boolean.sim_jitter"]},
                    {"trigger": "homeassistant", "event": "start"},
                ],
                "variables": {"sc": "{{ states('input_select.sim_scenario') }}"},
                "sensor": build_template_sensors(),
            },
            {
                "switch": [
                    {
                        "name": nm,
                        "default_entity_id": f"switch.{oid}",
                        "unique_id": f"sim_switch_{oid}",
                        "state": f"{{{{ is_state('input_boolean.{ib}', 'on') }}}}",
                        "turn_on": [{"action": "input_boolean.turn_on", "target": {"entity_id": f"input_boolean.{ib}"}}],
                        "turn_off": [{"action": "input_boolean.turn_off", "target": {"entity_id": f"input_boolean.{ib}"}}],
                    }
                    for oid, ib, nm in (("daikin_parter_power", "sim_daikin_parter", "Daikin Parter Power"), ("daikin_etaj_power", "sim_daikin_etaj", "Daikin Etaj Power"))
                ],
                "light": [
                    {
                        "name": nm,
                        "default_entity_id": f"light.{oid}",
                        "unique_id": f"sim_light_{oid}",
                        "state": f"{{{{ is_state('input_boolean.sim_light_{k}', 'on') }}}}",
                        "turn_on": [{"action": "input_boolean.turn_on", "target": {"entity_id": f"input_boolean.sim_light_{k}"}}],
                        "turn_off": [{"action": "input_boolean.turn_off", "target": {"entity_id": f"input_boolean.sim_light_{k}"}}],
                    }
                    for oid, k, nm in (
                        ("lumini_matrimonial", "matrimonial", "Lumini matrimonial"),
                        ("lumini_dormitor", "dormitor", "Lumini dormitor"),
                        ("lumini_geam_bucatarie", "bucatarie", "Lumini geam bucătărie"),
                        ("lumini_balcoane", "balcoane", "Lumini balcoane"),
                        ("lumini_terasa", "terasa", "Lumini terasă"),
                    )
                ],
                "climate": [
                    {
                        "name": nm,
                        "default_entity_id": f"climate.{oid}",
                        "unique_id": f"sim_climate_{oid}",
                        "hvac_modes": "{{ ['off', 'heat', 'cool'] }}",
                        "hvac_mode": f"{{{{ 'heat' if is_state('input_boolean.{ib}', 'on') else 'off' }}}}",
                        "hvac_action": f"{{{{ 'heating' if is_state('input_boolean.{ib}', 'on') else 'off' }}}}",
                        "current_temperature": "{{ 21.5 }}",
                        "set_hvac_mode": [
                            {"action": "input_boolean.turn_{{ 'off' if hvac_mode == 'off' else 'on' }}", "target": {"entity_id": f"input_boolean.{ib}"}}
                        ],
                    }
                    for oid, ib, nm in (("daikin_parter", "sim_daikin_parter", "Daikin Parter"), ("daikin_etaj", "sim_daikin_etaj", "Daikin Etaj"))
                ],
            },
        ],
    }


def card_config() -> dict:
    out = subprocess.run(
        ["node", "-e", "import('./demo/demo-config.js').then((m) => console.log(JSON.stringify(m.CARD_CONFIG)))"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    return json.loads(out.stdout)


def main() -> None:
    config_dir = Path(sys.argv[1]).resolve()
    config_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "configuration.yaml").write_text(yaml.safe_dump(build_config(config_dir), sort_keys=False, allow_unicode=True, width=200))
    card = card_config()
    classic = {k: v for k, v in card.items() if k not in ("three_d", "view_mode")}
    classic["view_mode"] = "classic"
    lovelace = {
        "title": "Sunsynk 3D test",
        "views": [
            {
                "title": "3D",
                "path": "energy-3d",
                "type": "sections",
                "max_columns": 4,
                "sections": [
                    {"type": "grid", "column_span": 4, "cards": [card]},
                    {
                        "type": "grid",
                        "cards": [
                            {"type": "entities", "title": "Simulation", "entities": ["input_select.sim_scenario", "input_boolean.sim_jitter", "switch.daikin_parter_power", "light.lumini_balcoane", "light.lumini_terasa", "light.lumini_matrimonial", "sun.sun"]},
                        ],
                    },
                ],
            },
            {"title": "Classic", "path": "classic", "cards": [classic]},
        ],
    }
    (config_dir / "ui-lovelace.yaml").write_text(yaml.safe_dump(lovelace, sort_keys=False, allow_unicode=True, width=200))
    # the built card goes to /local/sunsynk-3d/ (config/www/sunsynk-3d)
    www = config_dir / "www" / "sunsynk-3d"
    if www.exists():
        shutil.rmtree(www)
    www.mkdir(parents=True)
    for f in (ROOT / "dist").glob("*.js"):
        shutil.copy2(f, www / f.name)
    # skip onboarding: this instance is only ever used from 127.0.0.1 with trusted_networks
    storage = config_dir / ".storage"
    storage.mkdir(exist_ok=True)
    onboarding = storage / "onboarding"
    if not onboarding.exists():
        onboarding.write_text(json.dumps({"version": 4, "minor_version": 1, "key": "onboarding", "data": {"done": ["user", "core_config", "analytics", "integration"]}}))
    # Home Assistant 2026.10 keeps the HTTP config in storage with a confirm-or-revert
    # trial for YAML changes; write it as the confirmed ("stable") config so the test
    # instance only ever listens on 127.0.0.1:8124.
    (storage / "http").write_text(json.dumps({
        "version": 2,
        "minor_version": 2,
        "key": "http",
        "data": {
            "stable": {
                "server_port": 8124,
                "server_host": ["127.0.0.1"],
                "cors_allowed_origins": ["https://cast.home-assistant.io"],
                "login_attempts_threshold": -1,
                "ip_ban_enabled": True,
                "ssl_profile": "modern",
                "use_x_frame_options": True,
                "created_at": "2026-10-19T00:00:00+00:00",
                "error": None,
                "error_message": None,
            },
            "pending": None,
            "yaml_migration_done": True,
        },
    }, indent=2))
    print(f"wrote {config_dir}")


if __name__ == "__main__":
    main()
