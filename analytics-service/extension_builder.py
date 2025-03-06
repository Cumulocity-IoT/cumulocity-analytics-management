import subprocess
class ExtensionBuilder:
    """Helper class for building extensions"""

    def __init__(self, work_dir: str, extension_name: str):
        self.work_dir = work_dir
        self.extension_name = extension_name
        self.extension_file = f"{extension_name}.zip"
        self.extension_path = os.path.join(work_dir, self.extension_file)

    def build(self) -> None:
        """Build the extension using analytics_builder"""
        subprocess.run(
            [
                "/apama_work/apama-analytics-builder-block-sdk/analytics_builder",
                "build",
                "extension",
                "--input",
                self.work_dir,
                "--output",
                self.extension_path,
            ],
            check=True,
        )

    def get_file_path(self) -> str:
        """Get the path to the built extension file"""
        return self.extension_path