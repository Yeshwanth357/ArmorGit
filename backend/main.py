# main.py
import os
import json
import asyncio
import httpx
import base64
from pathlib import Path
from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
import uvicorn

# Load environment variables from the project root .env file
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=_env_path, override=True)

# Debug prints to confirm keys are loaded
print(f"[startup] .env loaded from: {_env_path}")
print(f"[startup] GEMINI_API_KEY set: {'YES' if os.getenv('GEMINI_API_KEY') else 'NO'}")
print(f"[startup] ARMORIQ_API_KEY set: {'YES' if os.getenv('ARMORIQ_API_KEY') else 'NO'}")
print(f"[startup] GITHUB_TOKEN set: {'YES' if os.getenv('GITHUB_TOKEN') else 'NO'}")

# Import helper libraries
from armoriq_guard import get_armoriq_guard, sse_log_queue, log_event
from agent import run_sandbox_agent, run_production_agent

app = FastAPI(title="ArmorGit API Server")

# Enable CORS – list all frontend origins explicitly.
# NOTE: allow_credentials=True is incompatible with allow_origins=["*"] per the
# CORS spec, so we enumerate origins instead.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",          # Vite dev server
        "http://127.0.0.1:5173",
        "https://armor-git-beryl.vercel.app",  # Vercel production
        "https://armorgit-1.onrender.com",     # Render (self, for health checks)
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global cache for SSE streaming and a lock for simulation execution
_last_prs = None
review_lock = asyncio.Lock()

async def fetch_open_prs() -> list:
    """Fetch all pull requests from the configured GitHub repository."""
    token = os.getenv("GITHUB_TOKEN")
    owner = os.getenv("GITHUB_OWNER")
    repo = os.getenv("GITHUB_REPO")
    if not all([token, owner, repo]):
        return []
    url = f"https://api.github.com/repos/{owner}/{repo}/pulls?state=all"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers={"Authorization": f"token {token}"})
        if resp.status_code != 200:
            return []
        prs = resp.json()
        return [
            {
                "number": pr.get("number"),
                "title": pr.get("title"),
                "author": pr.get("user", {}).get("login"),
                "url": pr.get("html_url"),
                "created_at": pr.get("created_at"),
            }
            for pr in prs
        ]

async def fetch_pr_details(pr_number: int) -> dict:
    """Retrieve a single PR and its changed files from GitHub.
    Returns a dict compatible with the simulation logic:
        {
            "title": str,
            "description": str,
            "files": {filepath: file_content, ...}
        }
    """
    token = os.getenv("GITHUB_TOKEN")
    owner = os.getenv("GITHUB_OWNER")
    repo = os.getenv("GITHUB_REPO")
    headers = {"Authorization": f"token {token}"}

    async with httpx.AsyncClient() as client:
        # Pull request metadata
        pr_resp = await client.get(
            f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}",
            headers=headers,
        )
        pr_resp.raise_for_status()
        pr_json = pr_resp.json()

        # Files changed in the PR
        files_resp = await client.get(
            f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/files",
            headers=headers,
        )
        files_resp.raise_for_status()
        files_json = files_resp.json()

        file_map: dict = {}
        for f in files_json:
            # Retrieve full file content via the blob API (requires the blob SHA)
            blob_sha = f.get("sha")
            if blob_sha:
                blob_resp = await client.get(
                    f"https://api.github.com/repos/{owner}/{repo}/git/blobs/{blob_sha}",
                    headers=headers,
                )
                blob_resp.raise_for_status()
                blob_content = base64.b64decode(blob_resp.json()["content"]).decode()
                file_map[f["filename"]] = blob_content
            else:
                # Fallback to patch diff if blob not available
                file_map[f["filename"]] = f.get("patch", "<no content>")

        return {
            "title": pr_json.get("title", ""),
            "description": pr_json.get("body", ""),
            "files": file_map,
        }

@app.get("/")
def root():
    return {
        "project": "ArmorGit",
        "status": "running"
    }

@app.get("/api/pull-requests")
async def get_pull_requests():
    """Return a JSON list of open PRs."""
    return await fetch_open_prs()

@app.get("/api/pull-requests/stream")
async def stream_pull_requests(request: Request):
    """SSE endpoint that streams PR list when it changes (polls GitHub)."""
    async def event_generator():
        global _last_prs
        while True:
            if await request.is_disconnected():
                break
            prs = await fetch_open_prs()
            if prs != _last_prs:
                _last_prs = prs
                yield f"data: {json.dumps(prs)}\n\n"
            await asyncio.sleep(10)
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/pull-requests/{pr_number}")
async def get_pr_details_endpoint(pr_number: int):
    """Retrieve details of a specific pull request including file content."""
    try:
        details = await fetch_pr_details(pr_number)
        return details
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def analyze_pull_request(mode: str, pr_data: dict):
    async with review_lock:
        # Drain any existing log items
        while not sse_log_queue.empty():
            try:
                sse_log_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        is_malicious = False

        # Check if PR contains prompt injections or rogue keywords
        desc_lower = (pr_data.get("description") or "").lower()
        if "override instruction" in desc_lower or "rogue-crypt" in desc_lower:
            is_malicious = True
        for content in (pr_data.get("files") or {}).values():
            if content:
                c_lower = content.lower()
                if "override instruction" in c_lower or "rogue-crypt" in c_lower or "rogue_crypt" in c_lower:
                    is_malicious = True

        log_event(
            "info",
            f"Initializing PR Maintainer Agent in {mode.upper()} mode.",
            {"pr_title": pr_data.get("title", ""), "is_malicious": is_malicious},
        )
        await asyncio.sleep(0.5)
        goal_description = "Check syntax of PR files and execute unit tests."
        try:
            guard = get_armoriq_guard(mode=mode)
            guard_bundle = guard.for_user("maintainer@company.com", goal=goal_description)
        except Exception as e:
            log_event("info", f"Error setting up ArmorIQ guard: {e}. Defaulting to sandbox mode.")
            guard = get_armoriq_guard(mode="sandbox")
            guard_bundle = guard.for_user("maintainer@company.com", goal=goal_description)
            mode = "sandbox"
        try:
            if mode == "production":
                await run_production_agent(pr_data, is_malicious, guard_bundle)
            else:
                await run_sandbox_agent(pr_data, is_malicious, guard_bundle)
        except Exception as e:
            log_event("info", f"Execution failed: {str(e)}")
        log_event("success", "Review finished successfully.")

@app.post("/api/review")
async def review_pull_request(request: Request, background_tasks: BackgroundTasks):
    data = await request.json()
    mode = data.get("mode", "production")
    pr_number = data.get("pr_number")
    
    if review_lock.locked():
        return {"status": "error", "message": "Review is already running. Please wait."}
        
    if not pr_number:
        return {
            "status": "error",
            "message": "pr_number is required"
        }

    try:
        pr_data = await fetch_pr_details(pr_number)
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }

    background_tasks.add_task(
        analyze_pull_request,
        mode,
        pr_data
    )
    return {"status": "ok", "message": "Review started."}

@app.get("/api/status")
async def get_status():
    """Lightweight poll endpoint so the frontend can sync the running state."""
    return {"running": review_lock.locked()}

@app.get("/api/verify-keys")
def verify_keys():
    # Reload env each request to reflect any changes
    _env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(dotenv_path=_env_path, override=True)
    armoriq_key = os.getenv("ARMORIQ_API_KEY", "")
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    armoriq_valid = (
        armoriq_key.startswith("ak_live_") or
        armoriq_key.startswith("ak_test_") or
        armoriq_key.startswith("ak_claw_")
    )
    gemini_valid = gemini_key.startswith("AIza") and len(gemini_key) > 20
    return {
        "armoriq_configured": bool(armoriq_key),
        "armoriq_valid": armoriq_valid,
        "gemini_configured": bool(gemini_key),
        "gemini_valid": gemini_valid,
        "gemini_key_format_ok": gemini_valid,
        "mode_recommended": "production" if (armoriq_valid and gemini_valid) else "sandbox",
    }

@app.get("/api/logs")
async def stream_logs(request: Request):
    async def log_generator():
        while True:
            if await request.is_disconnected():
                break
            try:
                log_item = await asyncio.wait_for(sse_log_queue.get(), timeout=2.0)
                yield f"data: {json.dumps(log_item)}\n\n"
            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'type': 'ping'})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                break
    return StreamingResponse(log_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    # reload=False prevents server from restarting when .env changes
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
