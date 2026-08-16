from __future__ import annotations

import io
import json

import pytest
from rdkit import Chem

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker import PROTOCOL_VERSION, process, run  # noqa: E402


def request_for_smiles(smiles: str, *, seed: int = 0xC0FFEE) -> dict:
    molecule = Chem.MolFromSmiles(smiles)
    assert molecule is not None
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": "test-request",
        "operation": "generate-conformer",
        "structure": {
            "format": "mol-v3000",
            "data": Chem.MolToMolBlock(molecule, forceV3000=True),
        },
        "options": {"includeHydrogens": True, "randomSeed": seed},
    }


def test_generates_deterministic_ethanol_conformer() -> None:
    first = process(request_for_smiles("CCO"))
    second = process(request_for_smiles("CCO"))

    assert first["ok"] is True
    assert first["result"]["forceField"] == "MMFF94s"
    assert first["result"]["atomCount"] == 9
    assert first["result"]["data"] == second["result"]["data"]
    parsed = Chem.MolFromMolBlock(first["result"]["data"], removeHs=False)
    assert parsed is not None
    assert parsed.GetNumConformers() == 1
    assert parsed.GetConformer().Is3D()


def test_preserves_a_chiral_center() -> None:
    response = process(request_for_smiles("C[C@H](O)F"))
    assert response["ok"] is True
    molecule = Chem.MolFromMolBlock(response["result"]["data"], removeHs=False)
    assert molecule is not None
    centers = Chem.FindMolChiralCenters(molecule, includeUnassigned=True)
    assert centers and centers[0][1] in {"R", "S"}


@pytest.mark.parametrize("smiles", ["c1ccccc1", "[NH4+]"])
def test_supports_aromatic_and_charged_small_molecules(smiles: str) -> None:
    response = process(request_for_smiles(smiles))
    assert response["ok"] is True
    assert response["result"]["forceField"] == "MMFF94s"


def test_falls_back_to_uff_when_mmff_parameters_are_unavailable() -> None:
    response = process(request_for_smiles("B(O)O"))
    assert response["ok"] is True
    assert response["result"]["forceField"] == "UFF"
    assert response["result"]["warnings"] == [
        "MMFF94s parameters were unavailable; UFF was used instead."
    ]


def test_rejects_multiple_components() -> None:
    response = process(request_for_smiles("CCO.Cl"))
    assert response == {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": "test-request",
        "ok": False,
        "error": {
            "code": "MULTIPLE_COMPONENTS",
            "message": "Generate 3D currently supports one connected molecule at a time.",
        },
    }


def test_reports_invalid_requests_without_crashing_stream() -> None:
    input_stream = io.StringIO("not-json\n" + json.dumps({"requestId": "bad"}) + "\n")
    output_stream = io.StringIO()
    run(input_stream, output_stream)
    responses = [json.loads(line) for line in output_stream.getvalue().splitlines()]
    assert [response["error"]["code"] for response in responses] == [
        "INVALID_REQUEST",
        "INVALID_REQUEST",
    ]
