"""
Logging configuration for analytics-service

Provides structured logging with JSON output for production environments
"""

import logging
import logging.config
import os
import json
from datetime import datetime


class JsonFormatter(logging.Formatter):
    """Custom JSON formatter for structured logging"""

    def format(self, record: logging.LogRecord) -> str:
        """Format log record as JSON"""
        log_obj = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "function": record.funcName,
            "line": record.lineno,
        }

        if record.exc_info:
            log_obj["exception"] = self.formatException(record.exc_info)

        if hasattr(record, "request_id"):
            log_obj["request_id"] = record.request_id

        return json.dumps(log_obj)


def setup_logging():
    """Configure logging for the application"""
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    use_json = os.getenv("LOG_FORMAT") == "json"

    # Determine if we're in production
    is_production = os.getenv("ENV", "development") == "production"

    logging_config = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "standard": {
                "format": "[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s",
                "datefmt": "%Y-%m-%d %H:%M:%S",
            },
            "json": {
                "()": JsonFormatter,
            },
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "level": log_level,
                "formatter": "json" if (use_json or is_production) else "standard",
                "stream": "ext://sys.stdout",
            },
            "file": {
                "class": "logging.handlers.RotatingFileHandler",
                "level": log_level,
                "formatter": "json" if is_production else "standard",
                "filename": os.getenv("LOG_FILE", "analytics-service.log"),
                "maxBytes": 10485760,  # 10MB
                "backupCount": 5,
            },
        },
        "loggers": {
            "": {  # Root logger
                "level": log_level,
                "handlers": ["console"] + (["file"] if is_production else []),
            },
            "werkzeug": {
                "level": "INFO",
                "handlers": ["console"],
            },
        },
    }

    logging.config.dictConfig(logging_config)

    # Log startup information
    logger = logging.getLogger(__name__)
    logger.info(f"Logging configured - Level: {log_level}, Format: {'JSON' if use_json else 'Standard'}")
    logger.info(f"Environment: {os.getenv('ENV', 'development')}")


def get_logger(name: str) -> logging.Logger:
    """Get a configured logger instance"""
    return logging.getLogger(name)
