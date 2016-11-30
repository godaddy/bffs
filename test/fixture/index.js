var path = require('path');
/**
 * Specification for lookups
 *
 * @type {Object}
 * @public
 */
Object.defineProperty(exports, 'spec', {
  get: function get() {
    return {
      name: 'example-module',
      version: '0.0.1',
      env: 'test'
    };
  }
});

/**
 * Publish payload
 *
 * @type {Object}
 * @public
 */
Object.defineProperty(exports, 'files', {
  get: function get() {
    return {
      files: [{
        fingerprint: 'a083jada091tr0l0l01zdjD',
        filename: 'example-module.js',
        compressed: path.join(__dirname, 'compressed.js'),
        extension: '.js',
        content: path.join(__dirname, 'content.js')
      }],
      config: { files: {} }
    };
  }
});
