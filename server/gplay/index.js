var PlayMusic = require('playmusic');
var Promise = require('bluebird');
var memoize = require('memoizee');
var https = require('https');
var url = require('url');

var playMusicAPI = new PlayMusic();

var memoizationDefaults = {
    maxAge: 60000,  // Expire cache after 1 minute
    preFetch: 0.3,  // If we are fetching within 10% of the end, fetch a new value
    maxHit: 10      // Max store of 10 cached values
};

var spout = function(message) {
    return function() {
        var arr = [message].concat(arguments);
        console.log.apply(console, arr);
    }
};

/*
 * Session
 */
var state = {};

function login(credentials, previousSession) {
    state.credentials = credentials;

    var login = memoize(
        Promise.promisify(playMusicAPI.login, {context: playMusicAPI}),
        memoizationDefaults
    );
    var init = memoize(
        Promise.promisify(playMusicAPI.init, {context: playMusicAPI}),
        memoizationDefaults
    );
    
    if(previousSession) {
        console.log('Trying to refresh previous session');
        state.session = previousSession;
        return init(state.session)
            .then(() => console.log('Refreshed session successfully'))
            .catch((err) => {
                console.log('Previous session invalid, creating new session');
                return this.login(credentials);
            });
    } else {
        console.log('Logging in to Google Music...');
    }

    state.session = {
        email: credentials.email,
        password: credentials.password,
        androidId: credentials.androidId || credentials.device
    };
    
    return login(credentials)
        .tap(spout('gmusic.login() ->'))
        .then(function(session) {
            state.session.masterToken = session.masterToken;
            state.session.androidId = session.androidId;
            return init(state.session)
        })
        .return(state.session)
        .tap(spout('gmusic.init() ->'))
}

module.exports = {
    login: login,
    search: memoize(
        Promise.promisify(playMusicAPI.search, {context: playMusicAPI}),
        Object.assign({}, memoizationDefaults, {
            length: 2
        })
    ),
    stream: memoize(
        Promise.promisify(playMusicAPI.getStreamUrl, {context: playMusicAPI}),
        Object.assign({}, memoizationDefaults, {
            length: 1
        })
    ),
    playlists: memoize(
        Promise.promisify(playMusicAPI.getPlayLists, {context: playMusicAPI}),
        Object.assign({}, memoizationDefaults, {
            length: 0
        })
    ),
    playlistEntries: memoize(
        Promise.promisify(playMusicAPI.getPlayListEntries, {context: playMusicAPI}),
        Object.assign({}, memoizationDefaults, {
            length: 0
        })
    ),
    favorites: memoize(
        Promise.promisify(playMusicAPI.getFavorites, {context: playMusicAPI}),
        Object.assign({}, memoizationDefaults, {
            length: 0
        })
    ),
    settings: memoize(
        Promise.promisify(playMusicAPI.getSettings, {context: playMusicAPI}),
        Object.assign({}, memoizationDefaults, {
            length: 0
        })
    ),
    /* getArtist - artistId, albumList, topTrackCount, relatedArtistCount[, callback] */
    artist: memoize(
        Promise.promisify(playMusicAPI.getArtist, {context: playMusicAPI}),
        Object.assign({}, memoizationDefaults, {
            length: 4
        })
    ),
    // getAlbum - albumId, includeTracks
    album: memoize(
        Promise.promisify(playMusicAPI.getAlbum, {context: playMusicAPI}),
        Object.assign({}, memoizationDefaults, {
            length: 2
        })
    ),
    // Attempts to download a track
    download: function(trackid) {
        if(!state.session) {
            return Promise.reject('Session missing, cannot download track');
        }
        console.log('Looking up trackid', trackid);
        return this.stream(trackid)
            .then(function(trackurl) {
                console.log('TrackID maps to', trackurl);
                return new Promise(function(resolve, reject) {

                    https.request(Object.assign(url.parse(trackurl), {
                        method: "GET",
                        url: trackurl,
                        headers: {
                            Authorization: "GoogleLogin auth=" + state.session.masterToken,
                            "X-Device-ID": state.session.androidId
                        }
                    })).on('response', function(response) {
                        console.log('Response from download server:', response.statusMessage)
                        response.pause();
                        resolve(response);
                    }).on('error', reject)
                        .end()
                });
            });
    }
    
};

Object.defineProperty(module.exports, 'session', {
    get: () => state.session
});