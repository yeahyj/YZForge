'use strict';

module.exports = {
  id: 'content-pack-presentation-v2',
  from: '0.1.0',
  to: '0.2.0',
  description: 'Regenerate ContentPack manifests for presentation request schema v2.',
  run() {
    // upgradeFramework runs the generator after all migrations. Existing
    // ContentPack descriptors remain valid; generation upgrades their manifest
    // schema and materializes an empty presentationRequests array when omitted.
  },
};
