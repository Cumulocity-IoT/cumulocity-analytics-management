# Copyright (c) 2025 Cumulocity GmbH
#
# SPDX-License-Identifier: Apache-2.0
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# @authors Christof Strack

import asyncio
import json

from dotenv import load_dotenv

from pyc8y.app import SimpleCumulocityApp
from pyc8y.model.application import Application


def register_microservice(name: str):
    """ Register a microservice at Cumulocity.

    The Cumulocity connection information is taken from the environment
    .env file located in the working directory.

    Args:
        name (str):  The application name to use
    """

    async def _register():
        load_dotenv('.env-admin')
        async with SimpleCumulocityApp() as c8y:
            # Verify this application is not registered, yet
            if await c8y.applications.get_all(name=name):
                raise ValueError(f"Microservice application named '{name}' seems to be already registered.")

            # parse microservice manifest
            with open('./src/cumulocity.json') as fp:
                manifest_json = json.load(fp)

            # Create application stub in Cumulocity
            required_roles = manifest_json['requiredRoles']
            app = await Application(c8y, name=name, key=f'{name}-key',
                                     type=Application.MICROSERVICE_TYPE,
                                     availability=Application.PRIVATE_AVAILABILITY,
                                     required_roles=required_roles).create()

            # Subscribe to newly created microservice
            subscription_json = {'application': {'self': f'{c8y.base_url}/application/applications/{app.id}'}}
            await c8y.post(f'/tenant/tenants/{c8y.tenant_id}/applications', json=subscription_json)

            print(f"Microservice application '{name}' (ID {app.id}) created. Tenant '{c8y.tenant_id}' subscribed.")

    asyncio.run(_register())


def unregister_microservice(name: str):
    """ Unregister a microservice from Cumulocity.

    The Cumulocity connection information is taken from the environment
    .env file located in the working directory.

    Args:
        name (str):  The name of the application to use

    Throws:
        LookupError  if a corresponding application cannot be found.
    """

    async def _unregister():
        load_dotenv('.env-admin')

        async with SimpleCumulocityApp() as c8y:
            try:
                # read applications by name, will throw IndexError if there is none
                app = (await c8y.applications.get_all(name=name))[0]
                # delete by ID
                await app.delete()
            except IndexError as e:
                raise LookupError(f"Cannot retrieve information for an application named '{name}'.") from e

            print(f"Microservice application '{name}' (ID {app.id}) deleted.")

    asyncio.run(_unregister())


def update_microservice(name: str):
    """ Update a microservice at Cumulocity.

    The Cumulocity connection information is taken from the environment
    .env file located in the working directory.

    Args:
        name (str):  The name of the application to use

    Throws:
        LookupError  if a corresponding application cannot be found.
    """

    async def _update():
        load_dotenv('.env-admin')

        async with SimpleCumulocityApp() as c8y:
            try:
                # read applications by name, will throw IndexError if there is none
                app = (await c8y.applications.get_all(name=name))[0]
                # parse microservice manifest
                with open('./src/cumulocity.json') as fp:
                    manifest_json = json.load(fp)

                # Create application stub in Cumulocity
                required_roles = manifest_json['requiredRoles']
                app.required_roles = required_roles
                await app.update()
            except IndexError as e:
                raise LookupError(f"Cannot retrieve information for an application named '{name}'.") from e

            print(f"Microservice application '{name}' (ID {app.id}) updated. "
                  f"New roles: {', '.join(required_roles)}.")

    asyncio.run(_update())


def get_bootstrap_credentials(name: str) -> (str, str):
    """ Get the bootstrap user credentials of a registered microservice.

    The Cumulocity connection information is taken from environment files
    (.env and .env-SAMPLE-NAME) located in the working directory.

    Args:
        name (str):  The name of the application to use

    Returns:
        A pair (username, password) for the credentials.

    Throws:
        LookupError  if a corresponding application cannot be found.
    """

    async def _get_bootstrap_credentials():
        load_dotenv('.env-admin')

        async with SimpleCumulocityApp() as c8y:
            try:
                # read applications by name, will throw IndexError if there is none
                app = (await c8y.applications.get_all(name=name))[0]
            except IndexError as e:
                raise LookupError(f"Cannot retrieve information for an application named '{name}'.") from e

            # read bootstrap user details
            user_json = await c8y.get(f'/application/applications/{app.id}/bootstrapUser')
            return c8y.base_url, user_json['tenant'], user_json['name'], user_json['password']

    return asyncio.run(_get_bootstrap_credentials())