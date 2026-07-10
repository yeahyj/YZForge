'use strict';

function runValidatorRules(rules) {
  for (const rule of rules) {
    if (!rule || typeof rule.name !== 'string' || typeof rule.run !== 'function') {
      throw new Error('Validator rules must provide a stable name and run function.');
    }
    rule.run();
  }
}

module.exports = {
  runValidatorRules,
};
