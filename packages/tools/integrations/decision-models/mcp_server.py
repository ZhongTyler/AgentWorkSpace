"""Local-only MCP entry point; model startup is lazy and shared with HTTP clients."""
from mcp.server.fastmcp import FastMCP
from local_runtime import predict, status, stop

mcp = FastMCP('research-decisions')


@mcp.tool()
def decision_status() -> dict:
    """Check the shared local Intern/Laya/StartLux gateway without loading a model."""
    return status()


@mcp.tool()
def decision_predict(state: dict, questions: dict) -> dict:
    """Advisory text classification/rating, local only. Starts shared GPU model on demand.

    questions maps names to {type: choice|noul|score, instructions: str,
    criteria: label-to-description object for choice, ordered description list for score}.
    Include other/unknown choices where appropriate. Up to 8 questions, 20 options,
    2048 total prompt tokens. Returned probabilities are NOT calibrated correctness.
    Do not use for authorization, publication approval or Knowledge fact verification.
    Default backend Intern. Explicit state envelope: _research_decision={backend:
    intern|laya|startlux, purpose: noncommercial_research}, payload={title, text}.
    StartLux requires that purpose. Laya is experimental; Chinese routing failed pilot.
    """
    return predict(state, questions)


@mcp.tool()
def decision_unload() -> dict:
    """Stop this integration's idle shared service and release GPU memory."""
    return stop()


if __name__ == '__main__':
    mcp.run(transport='stdio')
