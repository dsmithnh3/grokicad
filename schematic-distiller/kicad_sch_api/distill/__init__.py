"""
Lightweight schematic distillation helpers for LLM consumption.
"""

from .distiller import DistillationConfig, ProximityEdge, distill_schematic
from .model import DistilledComponent, DistilledNet, DistilledPin, DistilledSchematic

__all__ = [
    "DistillationConfig",
    "ProximityEdge",
    "DistilledPin",
    "DistilledComponent",
    "DistilledNet",
    "DistilledSchematic",
    "distill_schematic",
]

