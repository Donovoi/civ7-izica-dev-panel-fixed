"""Extract test data from a local Civ VII installation; no game files are distributed."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("data_directory", type=Path, help="Civ VII Base/modules/base-standard/data")
args = parser.parse_args()
data_directory = args.data_directory.resolve(strict=True)
roots = [ET.parse(data_directory / filename).getroot()
         for filename in ("attributes.xml", "progression-trees-common.xml")]

def rows(table):
    return [dict(row.attrib) for root in roots for row in root.findall(f"{table}/Row")]

attributes = rows("Attributes")
trees = {a["ProgressionTreeType"] for a in attributes if a.get("ProgressionTreeType")}
nodes = [n for n in rows("ProgressionTreeNodes") if n.get("ProgressionTree") in trees]
node_types = {n["ProgressionTreeNodeType"] for n in nodes}
fixture = {
    "source": "Local Civ VII base-standard/data XML (generated)",
    "attributes": attributes,
    "nodes": nodes,
    "prereqs": [p for p in rows("ProgressionTreePrereqs") if p.get("Node") in node_types],
    "unlocks": [u for u in rows("ProgressionTreeNodeUnlocks") if u.get("ProgressionTreeNodeType") in node_types],
}
if not trees or not nodes or not fixture["prereqs"]:
    raise SystemExit("No attribute trees or prerequisites found; check the game data directory/schema.")
destination = Path(__file__).resolve().parent / "fixtures" / "civ7-attribute-fixture.json"
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
print(f"Generated {len(trees)} trees and {len(nodes)} nodes in {destination.name}")
