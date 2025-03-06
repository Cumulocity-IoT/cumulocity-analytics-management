import requests
from typing import Dict, Any, Optional

class MonitorDownloader:
    """Helper class for downloading monitors"""

    @staticmethod
    async def download_monitor(
        url: str, headers: Dict[str, str], target_path: str
    ) -> None:
        """Download a monitor file"""
        response = requests.get(url, headers=headers, allow_redirects=True)
        response.raise_for_status()

        with open(target_path, "wb") as f:
            f.write(response.content)
