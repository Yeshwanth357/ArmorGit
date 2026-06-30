# armoriq_guard.py
import logging
import asyncio
import uuid
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger("armoriq_guard")

# Global event queue to stream logs to FastAPI Server-Sent Events (SSE)
sse_log_queue = asyncio.Queue()

def log_event(event_type: str, message: str, details: Optional[Dict[str, Any]] = None):
    """Utility to log events and push them to the SSE queue."""
    log_data = {
        "timestamp": os.getenv("CURRENT_TIME", "2026-06-29T23:30:00+05:30"),
        "type": event_type,  # 'info', 'agent', 'tool_call', 'armoriq_audit', 'armoriq_block', 'success'
        "message": message,
        "details": details or {}
    }
    # Thread-safe async push
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(sse_log_queue.put(log_data))
    except RuntimeError:
        # Fallback if no running event loop
        pass
    
    # Also log normally
    if event_type == 'armoriq_block':
        logger.error(f"[ArmorIQ BLOCK] {message}")
    elif event_type == 'armoriq_audit':
        logger.info(f"[ArmorIQ AUDIT] {message}")
    elif event_type == 'agent':
        logger.info(f"[Agent] {message}")
    else:
        logger.info(message)


class SandboxArmorIQBundle:
    """Mock implementation of the ArmorIQ ADK Bundle for Sandbox Mode."""
    def __init__(self, user_email: str, goal: Optional[str] = None):
        self.user_email = user_email
        self.goal = goal
        self._agent = None
        self._blocked_tools = set()
        self._blocked_actions = {}
        self.intent_token = f"tok_intent_{uuid.uuid4().hex[:12]}"
        
        # Log plan authorization
        log_event(
            "armoriq_audit",
            f"Cryptographic intent plan captured for goal: '{goal}'",
            {
                "user": user_email,
                "intent_token": self.intent_token,
                "status": "CAPTURED",
                "authorized_tools": ["check_syntax", "run_tests"]
            }
        )

    def install(self, agent: Any) -> "SandboxArmorIQBundle":
        self._agent = agent
        
        # Override the agent's callbacks
        agent.before_tool_callback = self._before_tool
        agent.after_tool_callback = self._after_tool
        log_event("info", f"ArmorIQ Guard successfully installed on ADK Agent: '{getattr(agent, 'name', 'unnamed')}'")
        return self
        
    async def _before_tool(self, tool, args, tool_context=None):
        tool_name = getattr(tool, "name", str(tool))
        # Handle string inputs from ADK or inspect standard name
        if hasattr(tool, "__name__"):
            tool_name = tool.__name__
            
        log_event("tool_call", f"Agent requesting tool: '{tool_name}' with args: {args}", {"tool": tool_name, "args": args})
        
        # Wait a moment to simulate cryptographic check latency
        await asyncio.sleep(0.5)

        # Enforce policies: only check_syntax and run_tests are authorized in the original goal plan.
        # update_dependency_tree is unauthorized and will be blocked.
        if tool_name == "update_dependency_tree":
            policy = "block-production-dependency-changes"
            reason = f"Tool '{tool_name}' is not in the signed intent plan. The agent was authorized only to check syntax and run tests."
            
            log_event(
                "armoriq_block",
                f"CRYPTOGRAPHIC VIOLATION: Blocked tool '{tool_name}' for user {self.user_email}. Reason: {reason}",
                {
                    "tool": tool_name,
                    "action": "block",
                    "reason": reason,
                    "matched_policy": policy,
                    "intent_token": self.intent_token,
                    "delegation_id": f"del_{uuid.uuid4().hex[:8]}"
                }
            )
            
            return {
                "error": f"This action is not permitted by your organization's policy (policy: {policy}). Reason: {reason}",
                "armoriq_enforcement": {
                    "blocked": True,
                    "action": "block",
                    "reason": reason,
                    "matched_policy": policy,
                    "tool": tool_name,
                    "delegation_id": f"del_{uuid.uuid4().hex[:8]}"
                }
            }
            
        # Authorized tools
        log_event(
            "armoriq_audit",
            f"Authorized tool call: '{tool_name}' validated against intent plan.",
            {
                "tool": tool_name,
                "action": "allow",
                "intent_token": self.intent_token
            }
        )
        return None

    async def _after_tool(self, tool, args, result, tool_context=None):
        tool_name = getattr(tool, "name", str(tool))
        if hasattr(tool, "__name__"):
            tool_name = tool.__name__
        log_event("info", f"Tool '{tool_name}' execution completed. Result: {result}")
        return result


class SandboxArmorIQ:
    """Mock factory mimicking ArmorIQADK for Sandbox Mode."""
    def __init__(self, api_key: str):
        self.api_key = api_key
        log_event("info", "ArmorIQ Sandbox Engine initialized. Sandbox logs will simulate cryptographic audits.")

    def for_user(self, user_email: str, goal: Optional[str] = None) -> SandboxArmorIQBundle:
        return SandboxArmorIQBundle(user_email=user_email, goal=goal)


# Factory to get either Real or Mock guard based on environment configurations
def get_armoriq_guard(api_key: Optional[str] = None, mode: str = "sandbox") -> Any:
    """Returns either real ArmorIQADK or SandboxArmorIQ based on API keys and requested mode."""
    resolved_api_key = api_key or os.getenv("ARMORIQ_API_KEY")
    
    if mode == "sandbox" or not resolved_api_key or not (
        resolved_api_key.startswith("ak_live_") or 
        resolved_api_key.startswith("ak_test_") or 
        resolved_api_key.startswith("ak_claw_")
    ):
        log_event("info", "Starting simulation in Sandbox Mode (Simulated ArmorIQ)")
        return SandboxArmorIQ(api_key=resolved_api_key or "ak_test_sandbox")
    else:
        try:
            from armoriq_sdk.integrations.google_adk import ArmorIQADK
            log_event("info", "Starting simulation in Production Mode (Real ArmorIQ SDK)")
            return ArmorIQADK(api_key=resolved_api_key)
        except Exception as e:
            log_event("info", f"Failed to initialize real ArmorIQ SDK: {e}. Falling back to Sandbox Mode.")
            return SandboxArmorIQ(api_key="ak_test_sandbox")
