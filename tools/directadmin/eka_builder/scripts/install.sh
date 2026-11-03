#!/bin/sh
# DirectAdmin runs this when the plugin is installed.
cd /usr/local/directadmin/plugins/eka_builder || exit 1
chown -R diradmin:diradmin .
chmod 755 user/index.html scripts/*.sh
chmod 700 data
[ -f data/config.ini ] || cp data/config.ini.example data/config.ini
chmod 600 data/config.ini
echo "Installed. Now edit /usr/local/directadmin/plugins/eka_builder/data/config.ini with the builder's address and host API key."
exit 0
