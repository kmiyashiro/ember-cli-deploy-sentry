/* jshint node: true */
'use strict';

var Promise   = require('ember-cli/lib/ext/promise');
var DeployPluginBase = require('ember-cli-deploy-plugin');
var SilentError         = require('silent-error');
var glob = require("glob");
var urljoin = require("url-join");
var request = require('request-promise');
var path = require('path');
var fs = require('fs');

module.exports = {
  name: 'ember-cli-deploy-sentry',

  createDeployPlugin: function(options) {
    var DeployPlugin = DeployPluginBase.extend({
      name: options.name,
      defaultConfig: {
        distDir: function(context) {
          return context.distDir;
        },
        filePattern: '/**/*.{js,map}',
        revisionKey: function(context) {
          return context.revisionData && context.revisionData.revisionKey;
        },

        didDeployMessage: function(context){
          return "Uploaded sourcemaps to sentry release: "
            + this.readConfig('sentryUrl')
            + '/'
            + this.readConfig('sentryOrganizationSlug')
            + '/'
            + this.readConfig('sentryProjectSlug')
            + '/releases/'
            + this.readConfig('revisionKey')
            + '/';
        }
      },
      requiredConfig: ['publicUrl', 'sentryUrl', 'sentryOrganizationSlug', 'sentryProjectSlug', 'sentryApiKey', 'revisionKey'],
      configure: function(/* context */) {
        this.log('validating config');

        ['distDir', 'filePattern', 'revisionKey', 'didDeployMessage'].forEach(this.applyDefaultConfigProperty.bind(this));

        this.log('config ok');
      },

      _createRelease: function createRelease(sentrySettings) {
        var url = urljoin(sentrySettings.url, '/api/0/projects/', sentrySettings.organizationSlug,  sentrySettings.projectSlug, '/releases/');
      
        return request({
          uri: url,
          method: 'POST',
          auth: {
            user: sentrySettings.apiKey
          },
          json: true,
          body: {
            version: sentrySettings.release
          },
          resolveWithFullResponse: true
        });
      },
      _deleteRelease: function createRelease(sentrySettings) {
        var url = urljoin(sentrySettings.url, '/api/0/projects/', sentrySettings.organizationSlug,  sentrySettings.projectSlug, '/releases/', sentrySettings.release) + '/';
      
        return request({
          uri: url,
          method: 'DELETE',
          auth: {
            user: sentrySettings.apiKey
          },
          json: true,
          body: {
            version: sentrySettings.release
          },
          resolveWithFullResponse: true
        });
      },
    
      _getUploadFiles: function getUploadFiles(dir, filePattern) {
        var pattern = path.join(dir, filePattern);
        return new Promise(function(resolve, reject) {
          // options is optional
          glob(pattern, function (err, files) {
            if(err) {
              reject(err);
            } else {
              resolve(files);
            }
          });
        }).then(function(files) {
          return files.map(function(file) {
            return path.relative(dir, file);
          });
        });     
      },
      
      _uploadFile: function uploadFile(sentrySettings, distDir, filePath) {
        var url = urljoin(sentrySettings.url, '/api/0/projects/', sentrySettings.organizationSlug,  sentrySettings.projectSlug, '/releases/', sentrySettings.release, '/files/');
  
        var formData = {
          name: urljoin(sentrySettings.publicUrl, filePath),
          file: fs.createReadStream(path.join(distDir, filePath))
        };
        
        return request({
          method: 'POST',
          uri: url,
          auth: {
            user: sentrySettings.apiKey
          },
          formData: formData
        });
      },
      
      _getReleaseFiles: function getReleaseFiles(sentrySettings) {
        var url = urljoin(sentrySettings.url, '/api/0/projects/', sentrySettings.organizationSlug,  sentrySettings.projectSlug, '/releases/', sentrySettings.release, '/files') + '/';
        return request({
          uri: url,
          auth: {
              user: sentrySettings.apiKey
          },
          json: true,
          body: {
              version: sentrySettings.release
          }
        });
      },

      upload: function(/* context */) {
        var plugin = this;
        var distDir = this.readConfig('distDir');
        var sentrySettings = {
            url: plugin.readConfig('sentryUrl'),
            publicUrl: plugin.readConfig('publicUrl'),
            organizationSlug: plugin.readConfig('sentryOrganizationSlug'),
            projectSlug: plugin.readConfig('sentryProjectSlug'),
            apiKey: plugin.readConfig('sentryApiKey'),
            release: plugin.readConfig('revisionKey')
        };
        var filePattern = this.readConfig('filePattern');
        
        if(!sentrySettings.release) {
          throw new Error('revisionKey setting is not available, either provide it manually or make sure the ember-cli-deploy-revision-data plugin is loaded');
        }
        return this._deleteRelease(sentrySettings).then(function() {}, function() {}).then(function() {
          return plugin._createRelease(sentrySettings).then(function(response) {
            return plugin._getUploadFiles(distDir, filePattern).then(function(files) {
                var uploads = [];
                for(var i=0;i<files.length;i++) { 
                    var file = files[i];
                    uploads.push(plugin._uploadFile(sentrySettings, distDir, files[i]));
                }
                return Promise.all(uploads).then(function() {
                    return plugin._getReleaseFiles(sentrySettings);
                }).then(function(response) {
                    console.log('RELEASE FILES: ', response);
                });
            });
          }, function(err){
            console.error(err);
            throw new Error('Creating release failed');
          });
        });
      },
      didDeploy: function(/* context */){
        var didDeployMessage = this.readConfig('didDeployMessage');
        if (didDeployMessage) {
          this.log(didDeployMessage);
        }
      }
    });
    return new DeployPlugin();
  }
};