"""
Copyright (c) 2026 Cumulocity GmbH

SPDX-License-Identifier: Apache-2.0

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Fetches a URL and hands the raw response body to EPL as a string, via Latin-1 decoding
(a lossless byte<->character mapping).

TEMPORARY DIAGNOSTIC VERSION: a synchronous action returning the result directly, instead of
reporting it via Correlator.sendTo() on a background thread. This exists to isolate which of
two distinct EPL<->Python marshalling code paths is responsible for truncating a binary
response at its first embedded null byte: Correlator.sendTo()'s dictionary-to-event
construction was confirmed to truncate (same symptom as the stringCodec connectivity plug-in
this replaced); a plain action return value is a different marshalling path, untested until
now. If this ALSO truncates, the defect is in EPL's string handling itself, not specific to
either subsystem - see repository/connectivity-bundle/README.md for the full investigation.
"""

import urllib.request
import urllib.error

from apama.eplplugin import EPLAction, EPLPluginBase


class GitHubFetchPluginClass(EPLPluginBase):

	def __init__(self, init):
		super(GitHubFetchPluginClass, self).__init__(init)
		self.getLogger().info("GitHubFetchPluginClass initialised")

	@EPLAction("action<string, dictionary<string,string> > returns dictionary<string,any>")
	def fetch(self, url, headers):
		try:
			request = urllib.request.Request(url, headers=headers, method="GET")
			with urllib.request.urlopen(request, timeout=120) as response:
				statusCode = response.getcode()
				body = response.read()
			return self._result(statusCode, body, "")
		except urllib.error.HTTPError as e:
			body = e.read() or b""
			return self._result(e.code, body, str(e))
		except Exception as e:
			return self._result(0, b"", str(e))

	def _result(self, statusCode, body, errorMessage):
		return {
			"statusCode": statusCode,
			"payload": body.decode("latin-1"),
			"errorMessage": errorMessage,
			"length": len(body),
		}
