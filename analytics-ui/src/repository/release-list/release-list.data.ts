/*
 * Copyright (c) 2025 Cumulocity GmbH
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @authors Christof Strack
 */

export interface ReleaseAsset {
  name: string;
  version: string;
  author: string;
  description: string;
  sizeBytes: number;
  downloadUrl: string;
  kind: 'bundle' | 'block';
}

/**
 * Static snapshot of
 * https://github.com/Cumulocity-IoT/analytics-builder-blocks-contrib/releases/tag/1.0.1
 * Mockup data only — not fetched at runtime.
 */
const REPO_DOWNLOAD_BASE =
  'https://github.com/Cumulocity-IoT/analytics-builder-blocks-contrib/releases/download/1.0.1/';

const AUTHOR = 'Cumulocity GmbH';
const VERSION = '1.0.1';

export const RELEASE_TAG_URL =
  'https://github.com/Cumulocity-IoT/analytics-builder-blocks-contrib/releases/tag/1.0.1';
export const RELEASE_PUBLISHED_AT = '2026-02-12';

function asset(
  name: string,
  description: string,
  sizeBytes: number,
  kind: 'bundle' | 'block' = 'block'
): ReleaseAsset {
  return {
    name,
    version: VERSION,
    author: AUTHOR,
    description,
    sizeBytes,
    downloadUrl: `${REPO_DOWNLOAD_BASE}${name}-${VERSION}.zip`,
    kind
  };
}

export const RELEASE_BUNDLES: ReleaseAsset[] = [
  asset('contrib-blocks', 'Full bundle containing every contributed Analytics Builder block in this release.', 58382, 'bundle'),
  asset('contrib-cumulocity-blocks', 'Bundle of Cumulocity-specific blocks — measurements, service requests and device I/O.', 20154, 'bundle'),
  asset('contrib-simulation-blocks', 'Bundle of signal generators and simulation blocks for testing analytic models.', 14881, 'bundle'),
  asset('contrib-service-request-blocks', 'Bundle of blocks for creating and managing Cumulocity service requests.', 4481, 'bundle')
];

export const RELEASE_BLOCKS: ReleaseAsset[] = [
  asset('Abs', 'Computes the absolute value of an incoming signal.', 1544),
  asset('AlarmBand', 'Raises an alarm when a signal leaves a configurable value band.', 2866),
  asset('ApproximateWaveFormGenerator', 'Generates an approximate waveform from a small set of shape parameters.', 3491),
  asset('AsyncSignal', "Emits a value asynchronously, decoupled from the model's evaluation cycle.", 4241),
  asset('BaseNConverter', 'Converts numbers between binary, octal, decimal and hexadecimal.', 2868),
  asset('Constant', 'Emits a fixed, configurable value on every evaluation.', 1775),
  asset('CreateBatchMeasurements', 'Creates a batch of measurements on a device in a single request.', 3957),
  asset('CreateMeasurement', 'Creates a single measurement with a configurable fragment and series.', 4289),
  asset('CreateMultiMeasurement', 'Creates one measurement carrying several fragments at once.', 4085),
  asset('CreateOpcUAWrite', 'Writes a value to a node on an OPC UA server.', 3701),
  asset('CreateServiceRequest', 'Creates a service request against a device or asset.', 4426),
  asset('CronTimer', 'Emits a tick according to a configurable cron expression.', 2814),
  asset('CSVJSONUtils', 'Converts data between CSV rows and JSON objects.', 2217),
  asset('CSVReader', 'Reads and emits rows from a CSV file.', 3568),
  asset('CSVWriter', 'Appends rows of data to a CSV file.', 3200),
  asset('DateTimeStringToSeconds', 'Parses a date/time string into epoch seconds.', 2465),
  asset('DeviceMeasurementInput', 'Feeds live device measurement data into the model as an input signal.', 4944),
  asset('DiscreteStatistics', 'Computes running statistics — min, max, mean, count — over a signal.', 3146),
  asset('EdgeDetection', 'Detects rising and falling edges in a boolean or threshold signal.', 2851),
  asset('HttpOutputBlock', 'Sends outgoing model data to an HTTP endpoint.', 8218),
  asset('IntervalPulseGenerator', 'Generates a pulse at a configurable time interval.', 2750),
  asset('IntToFloat32', 'Converts an integer value to a 32-bit floating point value.', 3020),
  asset('IntToFloat64', 'Converts an integer value to a 64-bit floating point value.', 3026),
  asset('LastestValue', 'Holds and re-emits the most recently received value.', 3479),
  asset('Limit', 'Clamps a signal to a configurable minimum and maximum.', 2109),
  asset('Logging', 'Writes signal values to the Apama log for debugging.', 2395),
  asset('MathOperation', 'Performs a configurable arithmetic operation on two inputs.', 2334),
  asset('ModelTime', 'Emits the current simulated model time.', 1596),
  asset('Nand', 'Performs a logical NAND on two boolean inputs.', 2190),
  asset('Nxor', 'Performs a logical XNOR (NXOR) on two boolean inputs.', 2204),
  asset('Offset', 'Applies a configurable additive offset to a signal.', 1722),
  asset('ProcessControl', 'Implements basic setpoint / process-control logic.', 3214),
  asset('Random', 'Generates a random value within a configurable range.', 2106),
  asset('RandomWalk', 'Generates a one-dimensional random walk signal.', 2860),
  asset('RandomWalk2D', 'Generates a two-dimensional random walk signal.', 3245),
  asset('RateLimiter', 'Limits how fast a signal is allowed to change.', 2883),
  asset('RootMeanSquare', 'Computes the root mean square of a windowed signal.', 2848),
  asset('RootMeanSquareAcceleration', 'Computes RMS acceleration from vibration input data.', 2929),
  asset('SendEmail', 'Sends an email notification from the analytic model.', 3063),
  asset('SumLast', 'Sums the last N values received on a signal.', 2213),
  asset('TimeAtLevelCounting', 'Counts the time a signal spends at each configurable level.', 2886),
  asset('TimeOffset', 'Shifts a timestamp by a configurable duration.', 2166),
  asset('TimeSeriesDownsample', 'Downsamples a high-frequency time series to a lower rate.', 2386),
  asset('TimeTicker', 'Emits a tick at a fixed, configurable time interval.', 2268),
  asset('WaveFormGenerator', 'Generates configurable sine, square, triangle or sawtooth waveforms.', 3071),
  asset('WebHook', 'Posts model data to a webhook URL.', 4409),
  asset('Xor', 'Performs a logical XOR on two boolean inputs.', 2192)
];

export const RELEASE_ASSETS: ReleaseAsset[] = [...RELEASE_BUNDLES, ...RELEASE_BLOCKS];
