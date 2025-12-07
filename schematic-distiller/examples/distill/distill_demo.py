"""
Example: distill a KiCad schematic into LLM-friendly JSON.
"""

import argparse
import json
from pathlib import Path

import kicad_sch_api as ksa
from kicad_sch_api.distill import DistillationConfig, distill_schematic


def main() -> None:
    parser = argparse.ArgumentParser(description="Distill KiCad schematic for LLM input")
    parser.add_argument("schematic", help="Path to .kicad_sch file")
    parser.add_argument(
        "--radius",
        type=float,
        default=20.0,
        help="Proximity radius in mm for nearby-part scoring (default: 20mm)",
    )
    parser.add_argument(
        "--no-hierarchy",
        action="store_true",
        help="Disable hierarchical connectivity traversal",
    )
    args = parser.parse_args()

    sch_path = Path(args.schematic)
    if not sch_path.exists():
        raise SystemExit(f"Schematic not found: {sch_path}")

    schematic = ksa.load_schematic(str(sch_path))
    cfg = DistillationConfig(proximity_radius_mm=args.radius, hierarchical=not args.no_hierarchy)
    distilled = distill_schematic(schematic, cfg)

    print(json.dumps(distilled.to_dict(), indent=2))


if __name__ == "__main__":
    main()

