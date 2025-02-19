//heavily modified from: https://raw.githubusercontent.com/danzel/Leaflet.utfgrid/leaflet-master/src/leaflet.utfgrid.js
//depends on corslite
const corslite = require("corslite");
const axios = require("axios");

L.UTFGrid = L.TileLayer.extend({
	options: {
		resolution: 4,
		pointerCursor: true,
        mouseInterval: 66  // Delay for mousemove events
	},

	_mouseOn: null,
    _mouseOnTile: null,
    _tileCharCode: null, // '<tileKey>:<charCode>' or null
    _cache: null, // {<tileKey>: <utfgrid>}
    _idIndex: null, // {<featureID>: {<tileKey1>: true, ...<tileKeyN>: true} }
    _throttleMove: null, // holds throttled mousemove handler
    //_throttleConnectEventHandlers: null, // holds throttled connection setup function

    _updateCursor: function(){ }, //no-op, overridden below

	onAdd: function (map) {
        this._cache = {};
        this._idIndex = {};

        L.TileLayer.prototype.onAdd.call(this, map);

        this._throttleMove = L.Util.throttle(this._move, this.options.mouseInterval, this);

        if (this.options.pointerCursor) {
            this._updateCursor = function(cursor) { this._container.style.cursor = cursor; }
        }

        map.on('boxzoomstart', this._disconnectMapEventHandlers, this);
        // have to throttle or we get an immediate click event on boxzoomend
        map.on('boxzoomend', this._throttleConnectEventHandlers, this);
        this._connectMapEventHandlers();

    //console.warn("this:", this);
    //try
    // Select the node that will be observed for mutations
    // Options for the observer (which mutations to observe)
    const config = { 
      attributes: false, 
      childList: true, 
      subtree: true,
    };

    // Callback function to execute when mutations are observed
    const callback = function(mutationsList, observer) {
      //console.log("mutationList:", mutationsList.length);
      // Use traditional 'for loops' for IE 11
      for(const mutation of mutationsList) {
        if (mutation.type === 'childList') {
          //console.log("mutation:", mutation);
          //console.log('A child node has been added or removed.');
          for(const removedNode of mutation.removedNodes){
            //console.log("cancel request");
            removedNode.cancelRequest && removedNode.cancelRequest();
          }
        }
        else if (mutation.type === 'attributes') {
          //console.log('The ' + mutation.attributeName + ' attribute was modified.');
        }
      }
    };

    // Create an observer instance linked to the callback function
    const observer = new MutationObserver(callback);

    //console.warn("this:", this._container);
    // Start observing the target node for configured mutations
    observer.observe(
      this._container,
      config);
	},

	onRemove: function () {
		var map = this._map;
        map.off('boxzoomstart', this._disconnectMapEventHandlers, this);
        map.off('boxzoomend', this._throttleConnectEventHandlers, this);
        this._disconnectMapEventHandlers();
		this._updateCursor('');
        L.TileLayer.prototype.onRemove.call(this, map);
	},

    createTile: function(coords, done) {
        const loadTileWorker = this._loadTile(coords, () => {
          done(undefined, undefined);
        })
        const tile = document.createElement('div');  // empty DOM node, required because this overrides L.TileLayer
      tile.cancelRequest = () => {
        //console.warn("cancel the request");
        if(loadTileWorker && loadTileWorker.cancel instanceof Function){
          loadTileWorker.cancel();
        }else{
          console.debug("It's not a function:", loadTileWorker);
        }
      }
      return tile;
	},

    setUrl: function(url, noRedraw) {
        this._cache = {};
        return L.TileLayer.prototype.setUrl.call(this, url, noRedraw);
    },

    _connectMapEventHandlers: function(){
        this._map.on('click', this._onClick, this);
        this._map.on('mousemove', this._throttleMove, this);
    },

    _disconnectMapEventHandlers: function(){
        this._map.off('click', this._onClick, this);
		this._map.off('mousemove', this._throttleMove, this);
    },

    _throttleConnectEventHandlers: function() {
        setTimeout(this._connectMapEventHandlers.bind(this), 100);
    },

    _update: function (center, zoom) {
        L.TileLayer.prototype._update.call(this, center, zoom);
    },

    _loadTile: function (coords, done) {
        var url = this.getTileUrl(coords);
		var key = this._tileCoordsToKey(coords);
		var self = this;
        if (this._cache[key]) { 
          //console.debug("cached");
          done();
          return {
            cancle: () => {console.debug("nothing to cancel");}
          }
        }
        const source = axios.CancelToken.source();
        axios.request({
          url,
          method: "get",
          cancelToken: source.token,
        })
          .then(response => {
            var data = response.data;
            self._cache[key] = data;
            L.Util.bind(self._handleTileLoad, self)(key, data);
            //console.info("loaded utf");
            done();
          })
          .catch(e => {
            if(axios.isCancel(e)){
              //console.log("request canceled because of:", e.message);
            }else{
              console.error("error:", e);
              self.fire('error', {error: e});
            }
          });
      return {
        cancel: () => {
          //console.log("cancel source");
          source.cancel("clean tiel request");
        },
      }
	},

    _handleTileLoad: function(key, data) {
        // extension point
    },

	_onClick: function (e) {
		this.fire('click', this._objectForEvent(e));
	},

	_move: function (e) {
        if (e.latlng == null){ return }

		var on = this._objectForEvent(e);

        if (on._tileCharCode !== this._tileCharCode) {
			if (this._mouseOn) {
				this.fire('mouseout', {
                    latlng: e.latlng,
                    data: this._mouseOn,
                    _tile: this._mouseOnTile,
                    _tileCharCode: this._tileCharCode
                });
				this._updateCursor('');
			}
			if (on.data) {
				this.fire('mouseover', on);
				this._updateCursor('pointer');
			}

			this._mouseOn = on.data;
            this._mouseOnTile = on._tile;
            this._tileCharCode = on._tileCharCode;
		} else if (on.data) {
			this.fire('mousemove', on);
		}
	},

	_objectForEvent: function (e) {
	    if (!e.latlng) return;  // keyboard <ENTER> events also pass through as click events but don't have latlng

        var map = this._map,
		    point = map.project(e.latlng),
		    tileSize = this.options.tileSize,
		    resolution = this.options.resolution,
		    x = Math.floor(point.x / tileSize),
		    y = Math.floor(point.y / tileSize),
		    gridX = Math.floor((point.x - (x * tileSize)) / resolution),
		    gridY = Math.floor((point.y - (y * tileSize)) / resolution),
			max = map.options.crs.scale(map.getZoom()) / tileSize;

        x = (x + max) % max;
        y = (y + max) % max;

        var tileKey = this._tileCoordsToKey({z: map.getZoom(), x: x, y: y});

		var data = this._cache[tileKey];
		if (!data) {
			return {
                latlng: e.latlng,
                data: null,
                _tile: null,
                _tileCharCode: null
            };
		}

        var charCode = data.grid[gridY].charCodeAt(gridX);
		var idx = this._utfDecode(charCode),
		    key = data.keys[idx],
		    result = data.data[key];

		if (!data.data.hasOwnProperty(key)) {
			result = null;
		}

		return {
            latlng: e.latlng,
            data: result,
            id: (result)? result.id: null,
            _tile: tileKey,
            _tileCharCode: tileKey + ':' + charCode
        };
	},

    _dataForCharCode: function (tileKey, charCode) {
        var data = this._cache[tileKey];
        var idx = this._utfDecode(charCode),
		    key = data.keys[idx],
		    result = data.data[key];

		if (!data.data.hasOwnProperty(key)) {
			result = null;
		}
        return result;
    },

	_utfDecode: function (c) {
		if (c >= 93) {
			c--;
		}
		if (c >= 35) {
			c--;
		}
		return c - 32;
	},

    _utfEncode: function (c) {
        //reverse of above, returns charCode for c
        //derived from: https://github.com/mapbox/glower/blob/mb-pages/src/glower.js#L37
        var charCode = c + 32;
        if (charCode >= 34) {
            charCode ++;
        }
        if (charCode >= 92) {
            charCode ++;
        }
        return charCode;
    }
});

L.utfGrid = function (url, options) {
	return new L.UTFGrid(url, options);
};
