"""
Health check functionality for analytics-service

Provides endpoints and checks for service health status
"""

import logging
import os
import psutil
import requests
from datetime import datetime
from typing import Dict, Any
from enum import Enum

logger = logging.getLogger(__name__)


class HealthStatus(str, Enum):
    """Health status enum"""
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


class HealthCheck:
    """Service health check provider"""

    def __init__(self):
        self.start_time = datetime.now()

    def get_health_status(self) -> Dict[str, Any]:
        """
        Get comprehensive health status

        Returns:
            Dict with health status and component checks
        """
        checks = {
            "timestamp": datetime.now().isoformat(),
            "uptime_seconds": (datetime.now() - self.start_time).total_seconds(),
            "status": HealthStatus.HEALTHY.value,
            "checks": {
                "system": self._check_system(),
                "cumulocity": self._check_cumulocity(),
                "github": self._check_github(),
            }
        }

        # Determine overall status
        all_statuses = [
            checks["checks"]["system"]["status"],
            checks["checks"]["cumulocity"]["status"],
            checks["checks"]["github"]["status"],
        ]

        if any(s == HealthStatus.UNHEALTHY.value for s in all_statuses):
            checks["status"] = HealthStatus.UNHEALTHY.value
        elif any(s == HealthStatus.DEGRADED.value for s in all_statuses):
            checks["status"] = HealthStatus.DEGRADED.value

        return checks

    def _check_system(self) -> Dict[str, Any]:
        """Check system resources"""
        try:
            memory = psutil.virtual_memory()
            cpu_percent = psutil.cpu_percent(interval=1)

            status = HealthStatus.HEALTHY.value
            if memory.percent > 90:
                status = HealthStatus.DEGRADED.value
            if cpu_percent > 95:
                status = HealthStatus.DEGRADED.value

            return {
                "status": status,
                "memory_percent": memory.percent,
                "cpu_percent": cpu_percent,
                "disk_usage_percent": psutil.disk_usage("/").percent,
            }
        except Exception as e:
            logger.error(f"Error checking system health: {e}")
            return {
                "status": HealthStatus.UNHEALTHY.value,
                "error": str(e),
            }

    def _check_cumulocity(self) -> Dict[str, Any]:
        """Check Cumulocity connectivity"""
        try:
            # This would check actual connectivity to Cumulocity
            # For now, return success if credentials are available
            if os.getenv("C8Y_BASEURL") and os.getenv("C8Y_BOOTSTRAP_TENANT"):
                return {
                    "status": HealthStatus.HEALTHY.value,
                    "message": "Cumulocity credentials available",
                }
            return {
                "status": HealthStatus.DEGRADED.value,
                "message": "Cumulocity credentials missing",
            }
        except Exception as e:
            logger.error(f"Error checking Cumulocity health: {e}")
            return {
                "status": HealthStatus.UNHEALTHY.value,
                "error": str(e),
            }

    def _check_github(self) -> Dict[str, Any]:
        """Check GitHub API connectivity"""
        try:
            # This would check actual connectivity to GitHub
            response = requests.head("https://api.github.com", timeout=5)
            if response.status_code == 200:
                return {
                    "status": HealthStatus.HEALTHY.value,
                    "message": "GitHub API reachable",
                }
            return {
                "status": HealthStatus.DEGRADED.value,
                "message": f"GitHub API returned {response.status_code}",
            }
        except requests.exceptions.Timeout:
            return {
                "status": HealthStatus.DEGRADED.value,
                "error": "GitHub API timeout",
            }
        except Exception as e:
            logger.warning(f"GitHub API check failed: {e}")
            return {
                "status": HealthStatus.DEGRADED.value,
                "error": str(e),
            }


# Global health check instance
health_check = HealthCheck()
