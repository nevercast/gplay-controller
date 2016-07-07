var express = require('express');
var app = express();
var gplay = require('./gplay');
var Cache = require('./cache');

var yaml = require('js-yaml');
var fs = require('fs');

try {
    var config = yaml.safeLoad(fs.readFileSync('./config.yml', 'utf8'));
} catch (e) {
    console.error('Reading Config', e);
    return;
}

var cache = new Cache('./songcache', (id) => gplay.download(id));
try {
    var session = JSON.parse(fs.readFileSync('./session.json', 'utf-8'));
} catch (e) {
    console.error('No previous session');
}


gplay.login(config.gplay, Object.assign(config.gplay, session ? {masterToken: session.token} : void 0))
    .return(gplay.session)
    .then(function(result) {
        session = result;
        fs.writeFileSync('./session.json', JSON.stringify({token: session.masterToken}));
        console.log('Completed login to Google Play');
    })
    .catch(function() {
        console.log('Login to Google Play failed');
    })
    .then(function() {
        return gplay.search('Innocence - Nero', 1)
    })
    .then(function(searchResults) {
        console.log('Search results', searchResults);
        var song = searchResults.entries.filter(function(entry) {
            return entry.type == 1
        }).shift();
        console.log('Beginning download...');
        return cache.produce(song.track.nid)
    })
    .then(function(stream) {
        console.log('Downloading...');
        stream.pipe(fs.createWriteStream('./download.mp3'))
            .on('finish', function() {
                console.log('Download complete');
            })
    })
    .catch(function(error) {
        console.log('Error finding song', error);
    })
    .done();


/*
 * Attempts to get the track from the cache
 * Otherwise it'll fetch the track from Google Play
 */
function getTrackAudioStream(trackid) {

}

app.get('/test', function(req, res) {
    res.json({
        'hello': 'there'
    })
});

module.exports = app;