import os
import microservice_util as ms_util

"""Create a sample specific .env-{sample_name} file using the
credentials of a corresponding microservice registered at Cumulocity."""
base_url, tenant, user, password = ms_util.get_bootstrap_credentials('analytics-ext-service')
with open(f'.env', 'w', encoding='UTF-8') as f:
    f.write(f'C8Y_BASEURL={base_url}\n'
            f'C8Y_BOOTSTRAP_TENANT={tenant}\n'
            f'C8Y_BOOTSTRAP_USER={user}\n'
            f'C8Y_BOOTSTRAP_PASSWORD={password}\n')






