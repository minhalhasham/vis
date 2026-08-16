"""Local MolecVis chemistry worker.

The process reads one JSON request per stdin line and emits exactly one JSON
response per stdout line. Diagnostic output belongs on stderr so Electron can
reliably frame responses without exposing an HTTP chemistry API to the LAN.
"""

from __future__ import annotations

import json
import sys
import traceback
from dataclasses import dataclass
from typing import Any, TextIO

from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem


PROTOCOL_VERSION = 1
SUPPORTED_OPERATION = "generate-conformer"

RDLogger.DisableLog("rdApp.warning")


@dataclass
class ChemistryRequestError(Exception):
    code: str
    message: str


def failure(request_id: str, code: str, message: str) -> dict[str, Any]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request_id,
        "ok": False,
        "error": {"code": code, "message": message},
    }


def validate_request(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ChemistryRequestError("INVALID_REQUEST", "The request must be a JSON object.")
    if value.get("protocolVersion") != PROTOCOL_VERSION:
        raise ChemistryRequestError(
            "INVALID_REQUEST",
            f"Unsupported chemistry protocol version {value.get('protocolVersion')!r}.",
        )
    if value.get("operation") != SUPPORTED_OPERATION:
        raise ChemistryRequestError("INVALID_REQUEST", "Unsupported chemistry operation.")
    if not isinstance(value.get("requestId"), str) or not value["requestId"]:
        raise ChemistryRequestError("INVALID_REQUEST", "A non-empty requestId is required.")
    structure = value.get("structure")
    if not isinstance(structure, dict) or structure.get("format") != "mol-v3000":
        raise ChemistryRequestError("INVALID_REQUEST", "A V3000 Molfile structure is required.")
    if not isinstance(structure.get("data"), str) or not structure["data"].strip():
        raise ChemistryRequestError("INVALID_REQUEST", "The Molfile is empty.")
    options = value.get("options")
    if not isinstance(options, dict):
        raise ChemistryRequestError("INVALID_REQUEST", "Conformer options are required.")
    if not isinstance(options.get("includeHydrogens"), bool):
        raise ChemistryRequestError("INVALID_REQUEST", "includeHydrogens must be a Boolean.")
    if not isinstance(options.get("randomSeed"), int):
        raise ChemistryRequestError("INVALID_REQUEST", "randomSeed must be an integer.")
    return value


def parse_molecule(molblock: str) -> Chem.Mol:
    try:
        molecule = Chem.MolFromMolBlock(
            molblock,
            sanitize=True,
            removeHs=False,
            strictParsing=True,
        )
    except Exception as exc:
        raise ChemistryRequestError(
            "INVALID_STRUCTURE",
            f"RDKit could not sanitize the structure: {exc}",
        ) from exc

    if molecule is None or molecule.GetNumAtoms() == 0:
        raise ChemistryRequestError(
            "INVALID_STRUCTURE",
            "The drawing is empty or has invalid atoms, bonds, charges, or valences.",
        )
    if len(Chem.GetMolFrags(molecule)) != 1:
        raise ChemistryRequestError(
            "MULTIPLE_COMPONENTS",
            "Generate 3D currently supports one connected molecule at a time.",
        )
    if any(atom.HasQuery() for atom in molecule.GetAtoms()):
        raise ChemistryRequestError(
            "INVALID_STRUCTURE",
            "Query atoms and generic atom labels cannot be converted to a 3D conformer.",
        )
    return molecule


def generate_conformer(request: dict[str, Any]) -> dict[str, Any]:
    request_id = request["requestId"]
    molecule = parse_molecule(request["structure"]["data"])
    molecule = Chem.AddHs(molecule, addCoords=True)

    params = AllChem.ETKDGv3()
    params.randomSeed = request["options"]["randomSeed"] & 0x7FFFFFFF
    params.enforceChirality = True
    params.useSmallRingTorsions = True
    params.useMacrocycleTorsions = True

    conformer_id = AllChem.EmbedMolecule(molecule, params)
    if conformer_id < 0:
        raise ChemistryRequestError(
            "EMBEDDING_FAILED",
            "RDKit could not find a plausible 3D embedding for this structure.",
        )

    warnings: list[str] = []
    if AllChem.MMFFHasAllMoleculeParams(molecule):
        status = AllChem.MMFFOptimizeMolecule(
            molecule,
            mmffVariant="MMFF94s",
            confId=conformer_id,
            maxIters=500,
        )
        force_field = "MMFF94s"
    elif AllChem.UFFHasAllMoleculeParams(molecule):
        status = AllChem.UFFOptimizeMolecule(molecule, confId=conformer_id, maxIters=500)
        force_field = "UFF"
        warnings.append("MMFF94s parameters were unavailable; UFF was used instead.")
    else:
        raise ChemistryRequestError(
            "UNSUPPORTED_FORCE_FIELD",
            "This molecule contains atoms or bonding that MMFF94s and UFF cannot parameterize.",
        )

    if status == 1:
        warnings.append("The force-field cleanup reached its iteration limit.")
    elif status < 0:
        raise ChemistryRequestError(
            "EMBEDDING_FAILED",
            "The force-field cleanup failed for the generated conformer.",
        )

    if not request["options"]["includeHydrogens"]:
        molecule = Chem.RemoveHs(molecule)

    molecule.SetProp("_Name", "MolecVis 3D conformer")
    molblock = Chem.MolToMolBlock(molecule, confId=0, forceV3000=True)
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request_id,
        "ok": True,
        "result": {
            "format": "mol-v3000",
            "data": molblock,
            "forceField": force_field,
            "atomCount": molecule.GetNumAtoms(),
            "warnings": warnings,
        },
    }


def process(value: Any) -> dict[str, Any]:
    request_id = value.get("requestId", "") if isinstance(value, dict) else ""
    try:
        request = validate_request(value)
        return generate_conformer(request)
    except ChemistryRequestError as exc:
        return failure(request_id, exc.code, exc.message)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        return failure(
            request_id,
            "INTERNAL_ERROR",
            "The chemistry worker encountered an unexpected error.",
        )


def run(input_stream: TextIO = sys.stdin, output_stream: TextIO = sys.stdout) -> None:
    for line in input_stream:
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            response = failure("", "INVALID_REQUEST", "The request was not valid JSON.")
        else:
            response = process(value)
        output_stream.write(json.dumps(response, separators=(",", ":")) + "\n")
        output_stream.flush()


if __name__ == "__main__":
    run()

