function Intro() {
let animationtime, rotatex, rotatey, rotatez;
var time = 0;
function spinything() {
  var startxx = Math.random()*1000
  var startxy = Math.random()*1000
  var startyx = Math.random()*1000
  var startyy = Math.random()*1000
  var startzx = Math.random()*1000
  var startzy = Math.random()*1000
  if (apperanceSettings.headinID) {
    $("#headendid").text("headend id:" + apperanceSettings.headinID)
  } else {
    $("#headendid").text("headend id: 0"+Math.round(Math.random()*100000))
  }
  if (apperanceSettings.headinID) {
    $("#serialnumber").text("headend id:" + apperanceSettings.serialNumber)
  } else {
    $("#serialnumber").text("serial number: TWCS"+"0"+Math.round(Math.random()*100000000))
  }
  $("#affilatename").text("affiliatename: " + apperanceSettings.affilateName)
    rotatex = perlin.get(startxx, startxy)*2
    rotatey = perlin.get(startyx, startyy)*2
    rotatez = perlin.get(startzx, startzy)*2
  var $logo = $(".intellistarlogo");
  $logo.css({transition: 'transform 2s linear', transform: `rotatex(${rotatex}turn) rotatey(${rotatey}turn) rotatez(${rotatez}turn)`});
  var rotinterval;
  setTimeout(function() {
    // The transition is set once. It used to be rewritten on every tick along
    // with the transform, which restarts a one-second transition ten times a
    // second on a 3D-transformed element for the rest of the intro — style
    // recalc that overlapped the boot work landing behind the card. The wander
    // looks the same: only the target moves.
    $logo.css('transition', 'transform 1s linear');
    rotinterval = setInterval(function(){
      time = time + .005;
      rotatex = perlin.get(startxx + time, startxy + time)*2
      rotatey = perlin.get(startyx + time, startyy + time)*2
      rotatez = perlin.get(startzx + time, startzy + time)*2
      $logo.css('transform', `rotatex(${rotatex}turn) rotatey(${rotatey}turn) rotatez(${rotatez}turn)`);
    }, 100);
  },1000)
  setTimeout(function () {
    clearInterval(rotinterval)
    $("#startup").fadeOut(0);
    // The display is on screen from here. The slide rotation starts with it.
    bootRevealed.reach();
  }, 5000)

  };
  spinything()
};
function applyApperanceSettings() {
  if (apperanceSettings.corebackgroud == 'buildings' || (apperanceSettings.corebackgroud != 'forest' && apperanceSettings.corebackgroud != 'ocean' && apperanceSettings.corebackgroud != 'mountain' && apperanceSettings.corebackgroud != 'city' && apperanceSettings.corebackgroud != 'neighborhood' && apperanceSettings.corebackgroud != 'southwest')) {
    $('.city-info-slide').css({'background': 'transparent url(/images/newbg/core_bg.png) no-repeat', 'background-position': '69% 41.5%', 'background-size': '120.3% 150.9%'})
  } else {
    $('.city-info-slide').css({'background': `transparent url(/images/newbg/core_${apperanceSettings.corebackgroud}_bg.png) no-repeat`, 'background-position': '69% 41.5%', 'background-size': '120.3% 150.9%'})
  }
  if (apperanceSettings.logoURL) {
    $('#logo-area img').attr("src",apperanceSettings.logoURL)
  }

}

$(function(){
  Intro()
  applyApperanceSettings()
})

//time manager
// Writing both fields every tick replaced their text nodes once a second and
// invalidated the layout of the header with them, for a date that changes once
// a day. Only write what actually changed.
var lastDateText = null, lastTimeText = null;
setInterval(
  function () {
    var today = new Date();

    var dateText = today.toString().slice(4,10).trimRight();
    if (dateText !== lastDateText) { lastDateText = dateText; $('#date').text(dateText); }

    var timeText = today.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true, minute: 'numeric', second: 'numeric' }).replace(/ /g,'');
    if (timeText !== lastTimeText) { lastTimeText = timeText; $('#time').text(timeText); }
  }
, 1000);
//location pull
// displayname is read by the lower bar before the location lookup resolves;
// leaving it undeclared rendered a literal "UNDEFINED:" on screen.
var maincitycoords = {name:"",lat:"",lon:"",displayname:""}, marinelocation,
locList = [], citySlideList = [], state, ccTickerCitiesList = [];

/**
 * A one-shot boot milestone. `reach()` is Promise resolve, so signalling twice
 * is harmless and callers registered after the fact still run.
 */
function bootStage() {
  var resolve;
  var stage = new Promise(function (res) { resolve = res; });
  stage.reach = resolve;
  return stage;
}
var bootDataReady = bootStage();
var bootRevealed = bootStage();

// Backstop. If nothing ever lands the display still comes up, in the same
// degraded state the old fixed timer produced.
setTimeout(bootDataReady.reach, 4000);

/**
 * Everything that needs the main location.
 *
 * All four branches of getMainLoc ended with these same four calls written out
 * again; only the expression assigned to `state` differed between them.
 *
 * Boot is not signalled here. Resolving the location only starts these
 * fetches -- grabSideandLowerBarData reaches the milestone when its data has
 * actually landed. See the comment there.
 */
function onMainLocationResolved() {
  getStatePopularCities(state, true)
  grabalmanacSlidesData()
  grabHealthData()
  grabSideandLowerBarData()
}


  //If there is a location inputted, use that.
//$.getJSON("http://"+document.location.hostname+":8081/https://services.surfline.com/forecasts/wave?spotId=500927576a2e4300134fbed8", function() {});
queryString = window.location.search;

var mainLocAttempts = 0;

/**
 * The location lookup had no failure path at all: any one of its four requests
 * failing left maincitycoords empty and the whole display blank, permanently,
 * with no retry. On an unattended screen a few seconds of network trouble at
 * boot meant a dead display until someone reloaded it by hand.
 */
function onMainLocFailed(configFailed) {
  mainLocAttempts++;
  var delay = Math.min(60000, 2000 * Math.pow(2, Math.min(mainLocAttempts, 5)));
  console.warn('[location] lookup failed (attempt ' + mainLocAttempts +
    '); retrying in ' + Math.round(delay / 1000) + 's');
  setTimeout(function () {
    // After a few failures against a configured location, fall through to IP
    // geolocation rather than retrying something that may simply be wrong.
    getMainLoc(configFailed || mainLocAttempts >= 3);
  }, delay);
}

function getMainLoc(configFailed) {
  if (queryString) {
    $.getJSON("https://api.weather.com/v3/location/search?query="+queryString.split("?")[1]+"&language=en-US&format=json&apiKey=" + api_key, function(data) {
      getExtraLocs(data.location.latitude[0],data.location.longitude[0],true);
      maincitycoords.lat = data.location.latitude[0]
      maincitycoords.lon = data.location.longitude[0]
      maincitycoords.name = data.location.displayName[0]
      $("#locationname").text("location name: "+data.location.displayName[0])
      maincitycoords.displayname = data.location.displayName[0]
      state = data.location.adminDistrict[0];
      onMainLocationResolved()
    }).fail(function () { onMainLocFailed(configFailed); });
  } else if (locationSettings.mainLocation.searchQuery.type && configFailed != true) {
    if (locationSettings.mainLocation.searchQuery.type == "geocode") {
      $.getJSON("https://api.weather.com/v3/location/point?geocode="+ locationSettings.mainLocation.searchQuery.val + "&language=en-US&format=json&apiKey=" + api_key, function(data) {
        getExtraLocs(data.location.latitude,data.location.longitude,true);
        maincitycoords.lat = data.location.latitude
        maincitycoords.lon = data.location.longitude
        maincitycoords.name = data.location.displayName
        maincitycoords.displayname = ((locationSettings.mainLocation.displayName) ? locationSettings.mainLocation.displayName : data.location.displayName)
        $("#locationname").text("location name: "+maincitycoords.displayname)
        // A point response is scalar throughout -- every field beside this one
        // is read without an index. Subscripting the state name returned
        // undefined (cidx is only ever assigned by the search branch below, and
        // is undefined until it runs), so a configured geocode location looked
        // up its ticker cities for no state at all.
        state = data.location.adminDistrict;

        onMainLocationResolved()
      }).fail(function () { onMainLocFailed(configFailed); });
    } else {
      $.getJSON("https://api.weather.com/v3/location/search?query="+locationSettings.mainLocation.searchQuery.val+"&locationType="+locationSettings.mainLocation.searchQuery.type+"&fuzzyMatch="+locationSettings.mainLocation.searchQuery.fuzzy+((locationSettings.mainLocation.searchQuery.country) ? "&countryCode="+locationSettings.mainLocation.searchQuery.country : "")+((locationSettings.mainLocation.searchQuery.state) ? "&adminDistrictCode="+locationSettings.mainLocation.searchQuery.state : "")+"&language=en-US&format=json&apiKey=" + api_key, function(data) {
          var cidx = ((locationSettings.mainLocation.searchQuery.searchResultNum && locationSettings.mainLocation.searchQuery.searchResultNum < data.location.placeId.length) ? locationSettings.mainLocation.searchQuery.searchResultNum : 0)
          getExtraLocs(data.location.latitude[cidx],data.location.longitude[cidx],true);
          maincitycoords.lat = data.location.latitude[cidx]
          maincitycoords.lon = data.location.longitude[cidx]
          maincitycoords.name = data.location.displayName[cidx]
          maincitycoords.displayname = ((locationSettings.mainLocation.displayName) ? locationSettings.mainLocation.displayName : data.location.displayName[cidx])
          $("#locationname").text("location name: "+maincitycoords.displayname)
          state = data.location.adminDistrict[cidx];

          onMainLocationResolved()
      }).fail(function () { onMainLocFailed(configFailed); });
    }
  } else {
    // get lat lon from user's ip
    $.getJSON("http://ip-api.com/json/?callback=?", function(data) {
      getExtraLocs(data.lat,data.lon,true);
      maincitycoords.name = data.city
      $("#locationname").text("location name: "+data.city)
      maincitycoords.displayname = data.city
      maincitycoords.lat = data.lat
      maincitycoords.lon = data.lon
      state = data.regionName
      onMainLocationResolved()
    }).fail(function () { onMainLocFailed(configFailed); });

  }
}
getMainLoc(false);

function getExtraLocs(lat,lon, onInit, whichReset) {
    $.getJSON('https://api.weather.com/v3/location/near?geocode=' + lat + ',' + lon + '&product=observation&format=json&apiKey=' + api_key, function(data) {
			var feature = data.location, geo, station, dist, ti=0;
      var minRadiusMiles = 0, maxRadiusMiles = 45;
      getLocLoop(0);
			function getLocLoop(i) {
        // Guard the recursion at the source. Several branches below advance the
        // index independently, and any one of them running past the end used to
        // produce a request for "geocode=undefined,undefined".
        if (!feature || !feature.latitude || i >= feature.latitude.length ||
            feature.latitude[i] === undefined) {
          onExtraAjaxFinish();
          return;
        }
        $.getJSON("https://api.weather.com/v3/location/point?geocode="+ feature.latitude[i] + "," + feature.longitude[i] + "&language=en-US&format=json&apiKey=" + api_key, function(dataii){
  				latgeo = feature.latitude[i];
  				longeo = feature.longitude[i];
  				dist = feature.distanceMi[i];
        displayname = dataii.location.displayName
         if (displayname == maincitycoords.displayname || displayname == state) {
          if ((dataii.location.locale.locale3 != maincitycoords.displayname && dataii.location.locale.locale3) || (dataii.location.locale.locale4 != maincitycoords.displayname && dataii.location.locale.locale4)) {
            displayname = (dataii.location.locale.locale3 != maincitycoords.displayname && dataii.location.locale.locale3) ? dataii.location.locale.locale3 : dataii.location.locale.locale4
          } else {
            if (feature.latitude.length == (i + 1)) {onExtraAjaxFinish()} else {getLocLoop(i + 1)}
            return
          }
        }
        for (var li = 0; li < citySlideList.length; li++) {
          if (displayname == citySlideList[li].displayname) {
            if ((dataii.location.locale.locale3 != citySlideList[li].displayname && dataii.location.locale.locale3) || (dataii.location.locale.locale4 != citySlideList[li].displayname && dataii.location.locale.locale4)) {
              displayname = (dataii.location.locale.locale3 != citySlideList[li].displayname && dataii.location.locale.locale3) ? dataii.location.locale.locale3 : dataii.location.locale.locale4
            } else {
              if (feature.latitude.length == (i + 1)) {onExtraAjaxFinish()} else {getLocLoop(i + 1)}
              return
            }
          }
        }
        if (i!=0) {
          citySlideList.push({lat: latgeo, lon:longeo, distance:dist, stationUrl:feature.stationId[i], name:displayname, displayname:displayname});
        };
        displayname = dataii.location.displayName
        if (displayname == maincitycoords.displayname || displayname == state) {
            if (feature.latitude.length == (i + 1)) {onExtraAjaxFinish()} else {getLocLoop(i + 1)}
            return
        }
        for (var li = 0; li < locList.length; li++) {
          if (displayname == locList[li].displayname) {
            if (feature.latitude.length == (i + 1)) {onExtraAjaxFinish()} else {getLocLoop(i + 1)}
            return
          }
        }
				if (dist >= minRadiusMiles && dist <= maxRadiusMiles) {
          if (ti < 3) {
              locList.push({lat: latgeo, lon:longeo, distance:dist, stationUrl:feature.stationId[i], name:displayname, displayname:displayname});
          } else {
            ti = ti - 1
          }
        }
        //for the 8 city slide
        if ((i + 1) < data.location.stationName.length && (citySlideList.length < 8 || locList.length < locationSettings.extraLocations.maxLocations)) {
          ti = ti + 1
          i = i + 1
          getLocLoop(i)
        } else {
          onExtraAjaxFinish()
        };
      }).fail(function(){
        if ((i + 1) >= feature.latitude.length || i >= 9) {onExtraAjaxFinish()} else {getLocLoop(i + 1)}
      })
			}

			// sort list by distance
    function onExtraAjaxFinish() {
  			locList.sort(function(a, b) {
  				return parseInt(a.distance) - parseInt(b.distance);
  			});
        locList.forEach((loc, i) => {
          loc.orderNum = ((locationSettings.extraLocations.locationOrderNum[i]) ? locationSettings.extraLocations.locationOrderNum[i] : locationSettings.extraLocations.maxLocations + i)
        });
        citySlideList.forEach((loc, i) => {
          loc.orderNum = ((locationSettings.aroundCityInfoLocs.locationOrderNum[i])? locationSettings.aroundCityInfoLocs.locationOrderNum[i] : locationSettings.aroundCityInfoLocs.maxLocations + i)
        });
        if (locationSettings.extraLocations.useAutoLocations == false){locList = []}
        if (locationSettings.aroundCityInfoLocs.useAutoLocations == false){citySlideList = []}
        function addConfigLocsLoop(i) {
          eloc = locationSettings.extraLocations.locs[i]
          if (eloc.searchQuery.type) {
            if (eloc.searchQuery.type == "geocode") {
              $.getJSON("https://api.weather.com/v3/location/point?geocode="+ eloc.searchQuery.val + "&language=en-US&format=json&apiKey=" + api_key, function(data) {
                locList.push({lat: data.location.latitude, lon:data.location.longitude, orderNum: ((eloc.orderNum) ? eloc.orderNum : i), distance:null, stationUrl:null, name:data.location.displayName, displayname:((eloc.displayName) ? eloc.displayName : data.location.displayName)});
                if (i < locationSettings.extraLocations.locs.length-1) {addConfigLocsLoop(i + 1)} else {sortFinishedLocList()}
              }).fail(function(){if (i < locationSettings.extraLocations.locs.length-1) {addConfigLocsLoop(i + 1)} else {sortFinishedLocList()}});
            } else {
              $.getJSON("https://api.weather.com/v3/location/search?query="+eloc.searchQuery.val+"&locationType="+eloc.searchQuery.type+"&fuzzyMatch="+eloc.searchQuery.fuzzy+((eloc.searchQuery.country) ? "&countryCode="+eloc.searchQuery.country : "")+((eloc.searchQuery.state) ? "&adminDistrictCode="+eloc.searchQuery.state : "")+"&language=en-US&format=json&apiKey=" + api_key, function(data) {
                  var cidx = ((eloc.searchQuery.searchResultNum && eloc.searchQuery.searchResultNum < data.location.placeId.length) ? eloc.searchQuery.searchResultNum : 0)
                  locList.push({lat: data.location.latitude[cidx], lon:data.location.longitude[cidx], orderNum: ((eloc.orderNum) ? eloc.orderNum : i), distance:null, stationUrl:null, name:data.location.displayName[cidx], displayname:((eloc.displayName) ? eloc.displayName : data.location.displayName[cidx])});
                  if (i < locationSettings.extraLocations.locs.length-1) {addConfigLocsLoop(i + 1)} else {sortFinishedLocList()}
              }).fail(function(){if (i < locationSettings.extraLocations.locs.length-1) {addConfigLocsLoop(i + 1)} else {sortFinishedLocList()}});
            }
          } else {if (i < locationSettings.extraLocations.locs.length-1) {addConfigLocsLoop(i + 1)} else {sortFinishedLocList()}}
        }
        addConfigLocsLoop(0)
        function addConfigAroundLocsLoop(i) {
          eloc = locationSettings.aroundCityInfoLocs.locs[i]
          if (eloc.searchQuery.type) {
            if (eloc.searchQuery.type == "geocode") {
              $.getJSON("https://api.weather.com/v3/location/point?geocode="+ eloc.searchQuery.val + "&language=en-US&format=json&apiKey=" + api_key, function(data) {
                citySlideList.push({lat: data.location.latitude, lon:data.location.longitude, orderNum: ((eloc.orderNum) ? eloc.orderNum : i), distance:null, stationUrl:null, name:data.location.displayName, displayname:((eloc.displayName) ? eloc.displayName : data.location.displayName)});
                if (i < locationSettings.aroundCityInfoLocs.locs.length-1) {addConfigAroundLocsLoop(i + 1)} else {sortFinishedAroundLocList()}
              }).fail(function(){if (i < locationSettings.aroundCityInfoLocs.locs.length-1) {addConfigAroundLocsLoop(i + 1)} else {sortFinishedAroundLocList()}});
            } else {
              $.getJSON("https://api.weather.com/v3/location/search?query="+eloc.searchQuery.val+"&locationType="+eloc.searchQuery.type+"&fuzzyMatch="+eloc.searchQuery.fuzzy+((eloc.searchQuery.country) ? "&countryCode="+eloc.searchQuery.country : "")+((eloc.searchQuery.state) ? "&adminDistrictCode="+eloc.searchQuery.state : "")+"&language=en-US&format=json&apiKey=" + api_key, function(data) {
                  var cidx = ((eloc.searchQuery.searchResultNum && eloc.searchQuery.searchResultNum < data.location.placeId.length) ? eloc.searchQuery.searchResultNum : 0)
                  citySlideList.push({lat: data.location.latitude[cidx], lon:data.location.longitude[cidx], orderNum: ((eloc.orderNum) ? eloc.orderNum : i), distance:null, stationUrl:null, name:data.location.displayName[cidx], displayname:((eloc.displayName) ? eloc.displayName : data.location.displayName[cidx])});
                  if (i < locationSettings.aroundCityInfoLocs.locs.length-1) {addConfigAroundLocsLoop(i + 1)} else {sortFinishedAroundLocList()}
              }).fail(function(){if (i < locationSettings.aroundCityInfoLocs.locs.length-1) {addConfigAroundLocsLoop(i + 1)} else {sortFinishedAroundLocList()}});
            }
          } else {if (i < locationSettings.aroundCityInfoLocs.locs.length-1) {addConfigAroundLocsLoop(i + 1)} else {sortFinishedAroundLocList()}}
        }
        addConfigAroundLocsLoop(0)
        function sortFinishedLocList() {
          locList.sort(function(a, b) {
    				return parseInt(a.orderNum) - parseInt(b.orderNum);
    			});
          locList.splice(locationSettings.extraLocations.maxLocations)
          grabCitySlidesData()
        }
        function sortFinishedAroundLocList() {
          citySlideList.sort(function(a, b) {
    				return parseInt(a.orderNum) - parseInt(b.orderNum);
    			});
          citySlideList.splice((locationSettings.aroundCityInfoLocs.maxLocations < 8)?locationSettings.aroundCityInfoLocs.maxLocations:8)
          grabCity8SlidesData()
        }
			// set the station for location 0
			//_locations[0].stationUrl = locList[0].stationUrl
      //start datapull
    }
		});
  }

  function getStatePopularCities(state, onInit) {
    $.getJSON("https://examples.opendatasoft.com/api/records/1.0/search/?dataset=largest-us-cities&q=&sort=population&facet=city&facet=state&refine.state=" + state, function(data) {
      if (data !== undefined && data.records.length != 0) {
      data.records.forEach((city, i) => {
        if (onInit==true) {
          ccTickerCitiesList.push({name:city.fields.city,displayname:city.fields.city,lat:(city.fields.coordinates).split(';')[0],lon:(city.fields.coordinates).split(';')[1]})
        } else {
          cctickerdata.push({name:city.fields.city,displayname:city.fields.city,lat:(city.fields.coordinates).split(';')[0],lon:(city.fields.coordinates).split(';')[1]})
          updateLocs("cctickerloc")
        };
        if (i == (data.records.length - 1)) {pullCCTickerData()};
      });
     } else {
       //if nothing just run the function and use placeholder locs
       pullCCTickerData();
     }
    });
  }


/**
 * The live weather record, built from the shape config.js declares.
 *
 * This used to be a second copy of that shape, written out in full here, and
 * the two had already drifted in both directions. config.js gained a
 * pressureTrend — with a comment recording that the sidebar printed "pressure
 * undefined" without it — but the copy that actually ran never did, so the fix
 * had no effect at all. travel and international went the other way: they only
 * ever existed here, which is why editing their city lists in config.js did
 * nothing. One of the two was always going to be the one nobody edited.
 *
 * config.js loads first (see index.html), so the shape is there by the time
 * this runs. JSON round-trip rather than a shared reference, so
 * weatherInfoSettings stays the pristine declared shape after the display has
 * filled this one in.
 */
var weatherInfo = JSON.parse(JSON.stringify(weatherInfoSettings));

//start data functions. these are run after their respective location functions finish
function grabCity8SlidesData() {
  weatherInfo.currentCond.city8slide = [];
  var url = "https://api.weather.com/v3/aggcommon/v3-wx-observations-current?geocodes="
  citySlideList.forEach((loc, i) => {
    url += `${loc.lat},${loc.lon};`
  });
  url += "&language=en-US&units=e&format=json&apiKey=" + api_key

  $.getJSON(url, function(data) {
    data.forEach((ajaxedLoc, i) => {
      if (!ajaxedLoc || !ajaxedLoc["v3-wx-observations-current"]) { return; }
      var city8sldieslocs = {displayname:"",temp:"",icon:"",wind:"",windspeed:""}
      city8sldieslocs.temp = ajaxedLoc["v3-wx-observations-current"].temperature
      city8sldieslocs.icon = ajaxedLoc["v3-wx-observations-current"].iconCode
      city8sldieslocs.wind = ((ajaxedLoc["v3-wx-observations-current"].windDirectionCardinal == "CALM" || ajaxedLoc["v3-wx-observations-current"].windSpeed == 0) ? 'Calm' :  ajaxedLoc["v3-wx-observations-current"].windDirectionCardinal) + ' ' + ((ajaxedLoc["v3-wx-observations-current"].windSpeed === 0) ? '' : ajaxedLoc["v3-wx-observations-current"].windSpeed)
      city8sldieslocs.windspeed = ajaxedLoc["v3-wx-observations-current"].windSpeed
      city8sldieslocs.displayname = (citySlideList[i].displayname)
      weatherInfo.currentCond.city8slides.cities.push(city8sldieslocs)
    });
  });
}

function grabTravelData() {
  var url = "https://api.weather.com/v3/aggcommon/v3-wx-forecast-daily-5day?geocodes="
  weatherInfo.travel.cities.forEach((loc, i) => {
    url += `${loc.lat},${loc.lon};`
  });
  url += "&language=en-US&units=e&format=json&apiKey=" + api_key
  $.getJSON(url, function(data) {
    data.forEach((ajaxedLoc, i) => {
      // A location the provider cannot resolve comes back null; skip it rather
      // than throwing and taking the rest of the slide down with it.
      if (!ajaxedLoc || !ajaxedLoc["v3-wx-forecast-daily-5day"]) { return; }
      var daycorrection = 0;
      if (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) {
        daycorrection = 1;
      }
      for (var hi = (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) ? 1 : 0, hidp = (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) ? 2 : 0; hi < 3 + daycorrection; hi++, hidp = hidp + 2) {
        weatherInfo.travel.cities[i].days[hi - daycorrection].dayName = ajaxedLoc["v3-wx-forecast-daily-5day"].dayOfWeek[hi].substring(0,3)
        weatherInfo.travel.cities[i].days[hi - daycorrection].icon = ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].iconCode[hidp]
        weatherInfo.travel.cities[i].days[hi - daycorrection].high = ajaxedLoc["v3-wx-forecast-daily-5day"].temperatureMax[hi]
        weatherInfo.travel.cities[i].days[hi - daycorrection].low = ajaxedLoc["v3-wx-forecast-daily-5day"].temperatureMin[hi]
        weatherInfo.travel.cities[i].days[hi - daycorrection].windspeed = ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].windSpeed[hidp]
      }
    })
  });
}
grabTravelData()
function grabInternationalData() {
  var url = "https://api.weather.com/v3/aggcommon/v3-wx-forecast-daily-5day?geocodes="
  weatherInfo.international.cities.forEach((loc, i) => {
    url += `${loc.lat},${loc.lon};`
  });
  url += "&language=en-US&units=e&format=json&apiKey=" + api_key
  $.getJSON(url, function(data) {
    data.forEach((ajaxedLoc, i) => {
      // A location the provider cannot resolve comes back null; skip it rather
      // than throwing and taking the rest of the slide down with it.
      if (!ajaxedLoc || !ajaxedLoc["v3-wx-forecast-daily-5day"]) { return; }
      var daycorrection = 0;
      if (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) {
        daycorrection = 1;
      }
      for (var hi = (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) ? 1 : 0, hidp = (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) ? 2 : 0; hi < 3 + daycorrection; hi++, hidp = hidp + 2) {
        weatherInfo.international.cities[i].days[hi - daycorrection].dayName = ajaxedLoc["v3-wx-forecast-daily-5day"].dayOfWeek[hi].substring(0,3)
        weatherInfo.international.cities[i].days[hi - daycorrection].icon = ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].iconCode[hidp]
        weatherInfo.international.cities[i].days[hi - daycorrection].high = ajaxedLoc["v3-wx-forecast-daily-5day"].temperatureMax[hi]
        weatherInfo.international.cities[i].days[hi - daycorrection].low = ajaxedLoc["v3-wx-forecast-daily-5day"].temperatureMin[hi]
        weatherInfo.international.cities[i].days[hi - daycorrection].windspeed = ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].windSpeed[hidp]
      }
    })
  });
}
grabInternationalData()

function grabCitySlidesData() {
  console.log("grabbed city data")
  /*weatherInfo.currentCond.weatherLocs = [];
  weatherInfo.dayPart.weatherLocs = [];
  weatherInfo.dayDesc.weatherLocs = [];
  weatherInfo.fiveDay.weatherLocs = [];
  weatherInfo.bulletin.weatherLocs = [];*/
  var url = "https://api.weather.com/v3/aggcommon/v3alertsHeadlines;v3-wx-forecast-daily-5day;v3-wx-observations-current;v3-wx-forecast-hourly-2day?geocodes="
  url += `${maincitycoords.lat},${maincitycoords.lon};`
  locList.forEach((loc, i) => {
    url += `${loc.lat},${loc.lon};`
  });
  url += "&language=en-US&units=e&format=json&apiKey=" + api_key

  $.getJSON(url, function(data) {
    data.forEach((ajaxedLoc, i) => {
        //Extra locations
        if (ajaxedLoc == null) {
          weatherInfo.currentCond.weatherLocs[i] = {noReport:true,displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),temp:"",cond:"",icon:"",humid:"",dewpt:"",pressure:"",pressureTrend:"",wind:"",windspeed:"",gust:"",feelslike:{type:"",val:""}}
          weatherInfo.dayPart.weatherLocs[i] = {noReport:true,displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),daytitle:"",hour:[{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},]}
          weatherInfo.dayDesc.weatherLocs[i] = {noReport:true,displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),day:[{name:"",desc:""},{name:"",desc:""},{name:"",desc:""},{name:"",desc:""}]}
          weatherInfo.fiveDay.weatherLocs[i] = {noReport:true,displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),day:[{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""}]}
          weatherInfo.bulletin.weatherLocs[i] = {displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),pages:[],enabled: false}
        } else {
          var weatherLocscc = {noReport:false,displayname:"",temp:"",cond:"",icon:"",humid:"",dewpt:"",pressure:"",pressureTrend:"",wind:"",windspeed:"",gust:"",feelslike:{type:"",val:""}}
          if (ajaxedLoc["v3-wx-observations-current"] == null) {
            weatherInfo.currentCond.weatherLocs[i] = {noReport:true,displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),temp:"",cond:"",icon:"",humid:"",dewpt:"",pressure:"",pressureTrend:"",wind:"",windspeed:"",gust:"",feelslike:{type:"",val:""}}
          } else {
            weatherLocscc.temp = ajaxedLoc["v3-wx-observations-current"].temperature
            weatherLocscc.cond = ajaxedLoc["v3-wx-observations-current"].wxPhraseLong
            weatherLocscc.icon = ajaxedLoc["v3-wx-observations-current"].iconCode
            weatherLocscc.humid = ajaxedLoc["v3-wx-observations-current"].relativeHumidity
            weatherLocscc.dewpt = ajaxedLoc["v3-wx-observations-current"].temperatureDewPoint
            weatherLocscc.pressure = (ajaxedLoc["v3-wx-observations-current"].pressureAltimeter).toFixed(2)
            weatherLocscc.pressureTrend = ((ajaxedLoc["v3-wx-observations-current"].pressureTendencyCode === 1 || ajaxedLoc["v3-wx-observations-current"].pressureTendencyCode === 3) ? '↑' : (ajaxedLoc["v3-wx-observations-current"].pressureTendencyCode === 2 || ajaxedLoc["v3-wx-observations-current"].pressureTendencyCode === 4) ? '↓' : ' S')
            weatherLocscc.wind = ((ajaxedLoc["v3-wx-observations-current"].windDirectionCardinal == "CALM" || ajaxedLoc["v3-wx-observations-current"].windSpeed == 0) ? 'calm' :  ajaxedLoc["v3-wx-observations-current"].windDirectionCardinal) + ' ' + ((ajaxedLoc["v3-wx-observations-current"].windSpeed === 0) ? '' : ajaxedLoc["v3-wx-observations-current"].windSpeed)
            weatherLocscc.windspeed = ajaxedLoc["v3-wx-observations-current"].windSpeed
            weatherLocscc.gust = ((ajaxedLoc["v3-wx-observations-current"].windGust!=undefined) ? ajaxedLoc["v3-wx-observations-current"].windGust + " mph": "none")
            weatherLocscc.feelslike.type = ((ajaxedLoc["v3-wx-observations-current"].temperature != ajaxedLoc["v3-wx-observations-current"].temperatureHeatIndex) ? "Heat Index" : ((ajaxedLoc["v3-wx-observations-current"].temperatureWindChill != ajaxedLoc["v3-wx-observations-current"].temperature) ? "Wind Chill" : "dontdisplay"))
            weatherLocscc.feelslike.val = ajaxedLoc["v3-wx-observations-current"].temperatureFeelsLike
            weatherLocscc.displayname = ((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname)
            weatherInfo.currentCond.weatherLocs[i] = weatherLocscc
          }
          //day part
          if (ajaxedLoc["v3-wx-forecast-hourly-2day"] == null) {
            weatherInfo.dayPart.weatherLocs[i] = {noReport:true,displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),daytitle:"",hour:[{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},]}
            weatherInfo.fiveDay.weatherLocs[i] = {noReport:true,displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),day:[{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""}]}
          } else {
            //functions converting hourly data into daypart
            var indexes = calcHourlyReport(ajaxedLoc["v3-wx-forecast-hourly-2day"]);
            function buildHourlyTimeTitle(time){
              var hour=dateFns.getHours(time);
              if (hour===0) {
                return 'Midnight';
              } else if (hour===12){
                return 'Noon';
              }
              return (dateFns.format(time,'h a')).replace(" ", "");
            }
            //get reporting hours: 12am, 6am, 12pm, 3pm, 5pm, 8pm...
            function calcHourlyReport(data) {
              var ret = [],
                targets = [0, 6, 12, 15, 17, 20],   // hours that we report
                current = dateFns.getHours(new Date()),
                now = new Date(),
                //firsthour = targets[ getNextHighestIndex(targets, current) ],
                start,
                hour, hi=0;

                switch (true) {
                  case (current < 3):
                    start = 6; //before 3:00
                  case (current < 9):
                    start = 12; break; //before 9:00 after 3:00
                  case (current < 12):
                    start = 15; break; //before 12:00 after 9:00
                  case (current < 14):
                    start = 17; break; //before 2:00 after 12:00
                  case (current < 17):
                    start = 6; break; //before 5:00 after 2:00
                  case (current < 20):
                      start = 6; break; //before 8:00 after 5:00
                  default:
                    start = 6;
                }
              // Bounded by the array length: without this the loop runs past the
              // end of the series, getHours(undefined) returns NaN, nothing ever
              // matches, and the browser tab hangs.
              while(ret.length<4 && hi < data.validTimeLocal.length){
                // hour must be equal or greater than current
                hour = dateFns.getHours(data.validTimeLocal[hi] );
                if ( dateFns.isAfter(data.validTimeLocal[hi], now) && (hour==start || ret.length>0) )  {
                  if ( targets.indexOf(hour)>=0 ) { // it is in our target list so record its index
                    ret.push(hi);
                  }
                }
                hi++;
              }
              // Short series (or an odd start hour) leaves gaps; fill them with
              // the next future hours so the slide still renders four columns.
              if (ret.length < 4) {
                for (var fi = 0; fi < data.validTimeLocal.length && ret.length < 4; fi++) {
                  if (ret.indexOf(fi) === -1 && dateFns.isAfter(data.validTimeLocal[fi], now)) {
                    ret.push(fi);
                  }
                }
                ret.sort(function(a,b){ return a - b; });
              }
              return ret;
            }
            function buildHourlyHeaderTitle(time) {
              var today = new Date(),
                tomorrow = dateFns.addDays(today, 1);

              // title based on the first hour reported
              switch (dateFns.getHours(time)) {

              case 6: // 6 - Nextday's Forecast / Today's Forecast
                // if 6am today
                if (dateFns.isToday(time)) {
                  return "Today's Forecast";
                }
                case 0: // 0 - Nextday's Forecast
                  return "Tomorrow's Forecast";

                case 12:
                  return "Today's Forecast";

                case 15:
                  return "Today's Forecast";

                case 17:
                  return "Tonight's Forecast";

                case 20:
                  return "Tonight's Forecast"
              }
            }

            var weatherLocsDP = {noReport:false,displayname:"",daytitle:"",hour:[{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},]};
            weatherLocsDP.daytitle = buildHourlyHeaderTitle(ajaxedLoc["v3-wx-forecast-hourly-2day"].validTimeLocal[indexes[0]])
            for (var hi = 0; hi < 4; hi++) {
              weatherLocsDP.hour[hi].time = buildHourlyTimeTitle(ajaxedLoc["v3-wx-forecast-hourly-2day"].validTimeLocal[indexes[hi]])
              weatherLocsDP.hour[hi].cond = ajaxedLoc["v3-wx-forecast-hourly-2day"].wxPhraseLong[indexes[hi]].replace('Scattered ', "Sct'd ").replace('Thunderstorms',"T'Storms").replace('Thundershowers',"T'Showers").replace('/',', ');
              weatherLocsDP.hour[hi].icon = ajaxedLoc["v3-wx-forecast-hourly-2day"].iconCode[indexes[hi]]
              weatherLocsDP.hour[hi].temp = ajaxedLoc["v3-wx-forecast-hourly-2day"].temperature[indexes[hi]]
              weatherLocsDP.hour[hi].wind = ajaxedLoc["v3-wx-forecast-hourly-2day"].windDirectionCardinal[indexes[hi]] + ' ' + ajaxedLoc["v3-wx-forecast-hourly-2day"].windSpeed[indexes[hi]]
              weatherLocsDP.hour[hi].windspeed= ajaxedLoc["v3-wx-forecast-hourly-2day"].windSpeed[indexes[hi]]
            }
            weatherLocsDP.displayname = ((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname)
            weatherInfo.dayPart.weatherLocs[i] = weatherLocsDP
          }
          //daydesc
          if (ajaxedLoc["v3-wx-forecast-daily-5day"] == null) {
            weatherInfo.dayPart.weatherLocs[i] = {noReport:true,displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),daytitle:"",hour:[{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},]}
          } else {
            var weatherLocsDD = {noReport:false,displayname:"",day:[{name:"",desc:""},{name:"",desc:""},{name:"",desc:""},{name:"",desc:""}]}
            var daycorrection = 0;
            if (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) {
              daycorrection = 1;
            }
            for (var hi = (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) ? 1 : 0; hi < 4 + daycorrection; hi++) {
              weatherLocsDD.day[hi - daycorrection].name = (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[hi].replace('Tomorrow', ajaxedLoc["v3-wx-forecast-daily-5day"].dayOfWeek[1]))
              weatherLocsDD.day[hi - daycorrection].desc = ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].narrative[hi] + ((ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].qualifierPhrase[hi] != null && ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].narrative[hi].includes(ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].qualifierPhrase[hi]) === false) ? ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].qualifierPhrase[hi] : '') + ((ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].windPhrase[hi - daycorrection] != null && ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].narrative[hi].includes(ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].windPhrase[hi]) === false) ? ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].windPhrase[hi] : '')
            }
            weatherLocsDD.displayname = ((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname)
            weatherInfo.dayDesc.weatherLocs[i] = weatherLocsDD
            //fiveday
            var weatherLocsFD = {noReport:false,displayname:"",day:[{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""}]};
            for (var hi = (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) ? 1 : 0, hidp = (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) ? 2 : 0; hi < 5 + daycorrection; hi++, hidp = hidp + 2) {
              weatherLocsFD.day[hi - daycorrection].name = ajaxedLoc["v3-wx-forecast-daily-5day"].dayOfWeek[hi].substring(0,3)
              weatherLocsFD.day[hi - daycorrection].icon = ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].iconCode[hidp]
              weatherLocsFD.day[hi - daycorrection].cond = ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].wxPhraseLong[hidp].replace('Scattered ', "Sct'd ").replace('Thunderstorms',"T'Storms").replace('Thundershowers',"T'Showers").replace('/',', ');
              weatherLocsFD.day[hi - daycorrection].high = ajaxedLoc["v3-wx-forecast-daily-5day"].temperatureMax[hi]
              weatherLocsFD.day[hi - daycorrection].windspeed = ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].windSpeed[hidp]
              weatherLocsFD.day[hi - daycorrection].low = ajaxedLoc["v3-wx-forecast-daily-5day"].temperatureMin[hi]
            }
            weatherLocsFD.displayname = ((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname)
            weatherInfo.fiveDay.weatherLocs[i] = weatherLocsFD
          }
          //bulletin
          var weatherLocsWA = {displayname:"",pages:[],enabled: false};
          weatherLocsWA.displayname = ((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname)
          if (ajaxedLoc["v3alertsHeadlines"] != undefined){
            var displayday;
            var bulletintext = "";
            var ret = [];
      			var ai=0;
      			//info
      			//get only weather alers
      			for (ai=0; ai<=ajaxedLoc["v3alertsHeadlines"].alerts.length - 1; ai++) {
      				warning = ajaxedLoc["v3alertsHeadlines"].alerts[ai].categories[0].category;
      				if ((warning == "Met" && weatherInfo.bulletin.includesevereonbulletin == true) || (warning == "Met" && i != 0) || (warning == "Met" && ajaxedLoc["v3alertsHeadlines"].alerts[ai].eventDescription != "Severe Thunderstorm Warning" && ajaxedLoc["v3alertsHeadlines"].alerts[ai].eventDescription == "Flash Flood Warning" != ajaxedLoc["v3alertsHeadlines"].alerts[ai].eventDescription != "Tornado Warning"))  {
      					ret.push({idx:ai, priority: getWarningPosition(ajaxedLoc["v3alertsHeadlines"].alerts[ai].eventDescription)})
      				}
      			};
      			if (ret.length != 0) {
      				ret.sort(function(a,b) {return a.priority - b.priority;});

            for (ai of ret) {
              var icount = 0;
              getexpiredate = function(expiretime) {
                dateFns.format(new Date(expiretime), "h:mm");
                if (dateFns.isToday(expiretime) != true) {
                  var numday = dateFns.getDay(expiretime);
                  displayday = {"0":"SUN","1":"MON","2":"TUE","3":"WED","4":"THU","5":"FRI","6":"SAT"}[numday] + ".";
                } else {
                  displayday = "Today."
                }
                return dateFns.format(new Date(expiretime), "h:mm A ") + displayday
              }
              if (icount != ret.length - 1) {
                bulletintext += ajaxedLoc["v3alertsHeadlines"].alerts[ai.idx].eventDescription + " in effect until " + (getexpiredate(ajaxedLoc["v3alertsHeadlines"].alerts[ai.idx].expireTimeLocal) + "\n \n")
              } else {
                bulletintext += ajaxedLoc["v3alertsHeadlines"].alerts[ai.idx].eventDescription + " in effect until " + (getexpiredate(ajaxedLoc["v3alertsHeadlines"].alerts[ai.idx].expireTimeLocal) + "\n \n")
              }
              var icount = icount + 1;
            }

            function splitLines() {

               var warningsplitstr = bulletintext.split(/(?![^\n]{1,40}$)([^\n]{1,40})\s/g)
               warningsplitstr.pop()
               warningsplitstr.pop()
               var warningpageidx = 0;
               var warninglineidx = 0;
               warningsplitstr.forEach(warningline => {
                if (warningline != "") {
                  if (warninglineidx == 0) {
                    weatherLocsWA.pages[warningpageidx] = ""
                  }
                weatherLocsWA.pages[warningpageidx] += (warningline + '<br>')
                warninglineidx += 1;
                if (warninglineidx == 7) {
                  warningpageidx += 1
                  warninglineidx = 0
                }
              }
            });
            }
            splitLines()
            weatherLocsWA.enabled = true
            weatherInfo.bulletin.weatherLocs[i] = weatherLocsWA
          }
        } else {weatherInfo.bulletin.weatherLocs[i] = weatherLocsWA}
      }
    });
  }).fail(function() {
    for (var i = 0; i < (locList.length+1); i++) {
      weatherInfo.currentCond.weatherLocs[i] = {noReport:true,displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),temp:"",cond:"",icon:"",humid:"",dewpt:"",pressure:"",pressureTrend:"",wind:"",windspeed:"",gust:"",feelslike:{type:"",val:""}}
      weatherInfo.dayPart.weatherLocs[i] = {noReport:true,displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),daytitle:"",hour:[{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},{time:"",cond:"",icon:"",temp:"",wind:"",windspeed:""},]};
      weatherInfo.dayDesc.weatherLocs[i] = {noReport:true,displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),day:[{name:"",desc:""},{name:"",desc:""},{name:"",desc:""},{name:"",desc:""}]}
      weatherInfo.fiveDay.weatherLocs[i] = {noReport:true,displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),day:[{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""},{name:"",cond:"",icon:"",high:"",low:"",windspeed:""}]};
      weatherInfo.bulletin.weatherLocs[i] = {displayname:((i ==0 ) ? maincitycoords.displayname : locList[i-1].displayname),pages:[],enabled: false};
    }
  })
}

function grabSideandLowerBarData() {
  weatherInfo.bulletin.marqueewarnings = [];
  weatherInfo.bulletin.severewarnings = [];
  var url = "https://api.weather.com/v3/aggcommon/v3alertsHeadlines;v3-wx-forecast-daily-5day;v3-wx-observations-current;v3-wx-forecast-hourly-2day?geocodes="
  url += `${maincitycoords.lat},${maincitycoords.lon};`
  url += "&language=en-US&units=e&format=json&apiKey=" + api_key

  $.getJSON(url, function(data) {
        var ajaxedLoc = data[0]
        if (ajaxedLoc == null) {
          weatherInfo.currentCond.sidebar.displayname = maincitycoords.displayname
          weatherInfo.currentCond.sidebar.noReport = true
          weatherInfo.dayPart.lowerbar.displayname = maincitycoords.displayname
          weatherInfo.dayPart.lowerbar.noReport = true
          weatherInfo.dayDesc.lowerbar.displayname = maincitycoords.displayname
          weatherInfo.dayDesc.lowerbar.noReport = true
          weatherInfo.fiveDay.lowerbar.displayname = maincitycoords.displayname
          weatherInfo.fiveDay.lowerbar.noReport = true
        } else {
          if (ajaxedLoc["v3-wx-observations-current"] == null) {
            weatherInfo.currentCond.sidebar.displayname = maincitycoords.displayname
            weatherInfo.currentCond.sidebar.noReport = true
          } else {
            weatherInfo.currentCond.sidebar.temp = ajaxedLoc["v3-wx-observations-current"].temperature
            weatherInfo.currentCond.sidebar.cond = ajaxedLoc["v3-wx-observations-current"].wxPhraseLong
            weatherInfo.currentCond.sidebar.icon = ajaxedLoc["v3-wx-observations-current"].iconCode
            weatherInfo.currentCond.sidebar.humid = ajaxedLoc["v3-wx-observations-current"].relativeHumidity
            weatherInfo.currentCond.sidebar.dewpt = ajaxedLoc["v3-wx-observations-current"].temperatureDewPoint
            weatherInfo.currentCond.sidebar.pressure = (ajaxedLoc["v3-wx-observations-current"].pressureAltimeter).toFixed(2)
            weatherInfo.currentCond.sidebar.pressureTrend = ((ajaxedLoc["v3-wx-observations-current"].pressureTendencyCode === 1 || ajaxedLoc["v3-wx-observations-current"].pressureTendencyCode === 3) ? '↑' : (ajaxedLoc["v3-wx-observations-current"].pressureTendencyCode === 2 || ajaxedLoc["v3-wx-observations-current"].pressureTendencyCode === 4) ? '↓' : ' S')
            weatherInfo.currentCond.sidebar.wind = ((ajaxedLoc["v3-wx-observations-current"].windDirectionCardinal == "CALM" || ajaxedLoc["v3-wx-observations-current"].windSpeed == 0) ? 'calm' :  ajaxedLoc["v3-wx-observations-current"].windDirectionCardinal) + ' ' + ((ajaxedLoc["v3-wx-observations-current"].windSpeed === 0) ? '' : ajaxedLoc["v3-wx-observations-current"].windSpeed)
            weatherInfo.currentCond.sidebar.windspeed = ajaxedLoc["v3-wx-observations-current"].windSpeed
            weatherInfo.currentCond.sidebar.gust = ((ajaxedLoc["v3-wx-observations-current"].windGust!=undefined) ? ajaxedLoc["v3-wx-observations-current"].windGust + " mph" : "none")
            weatherInfo.currentCond.sidebar.visibility = ajaxedLoc["v3-wx-observations-current"].visibility
            weatherInfo.currentCond.sidebar.uvidx = ajaxedLoc["v3-wx-observations-current"].uvDescription
            weatherInfo.currentCond.sidebar.ceiling = ajaxedLoc["v3-wx-observations-current"].cloudCeiling
            weatherInfo.currentCond.sidebar.feelslike.type = ((ajaxedLoc["v3-wx-observations-current"].temperature != ajaxedLoc["v3-wx-observations-current"].temperatureHeatIndex) ? "heat index" : ((ajaxedLoc["v3-wx-observations-current"].temperatureWindChill != ajaxedLoc["v3-wx-observations-current"].temperature) ? "wind chill" : "dontdisplay"))
            weatherInfo.currentCond.sidebar.feelslike.val = ajaxedLoc["v3-wx-observations-current"].temperatureFeelsLike
            weatherInfo.currentCond.sidebar.displayname = maincitycoords.displayname
          }
          //day part
          if (ajaxedLoc["v3-wx-forecast-hourly-2day"] == null) {
            weatherInfo.dayPart.lowerbar.displayname = maincitycoords.displayname
            weatherInfo.dayPart.lowerbar.noReport = true
          } else {
            //functions converting hourly data into daypart
            var indexes = calcHourlyReport(ajaxedLoc["v3-wx-forecast-hourly-2day"]);
            function buildHourlyTimeTitle(time){
              var hour=dateFns.getHours(time);
              if (hour===0) {
                return 'Midnight';
              } else if (hour===12){
                return 'Noon';
              }
              return (dateFns.format(time,'h a'))//.replace(" ", "");
            }
            //get reporting hours: 12am, 6am, 12pm, 3pm, 5pm, 8pm...
            function calcHourlyReport(data) {
              var ret = [],
                targets = [0, 6, 12, 15, 17, 20],   // hours that we report
                current = dateFns.getHours(new Date()),
                now = new Date(),
                //firsthour = targets[ getNextHighestIndex(targets, current) ],
                start,
                hour, hi=0;

              switch (true) {
                case (current < 3):
                  start = 6; //before 3:00
                case (current < 9):
                  start = 12; break; //before 9:00 after 3:00
                case (current < 12):
                  start = 15; break; //before 12:00 after 9:00
                case (current < 14):
                  start = 17; break; //before 2:00 after 12:00
                case (current < 17):
                  start = 20; break; //before 5:00 after 2:00
                case (current < 20):
                    start = 0; break; //before 8:00 after 5:00
                default:
                  start = 6;
              }
              // Bounded by the array length: without this the loop runs past the
              // end of the series, getHours(undefined) returns NaN, nothing ever
              // matches, and the browser tab hangs.
              while(ret.length<4 && hi < data.validTimeLocal.length){
                // hour must be equal or greater than current
                hour = dateFns.getHours(data.validTimeLocal[hi] );
                if ( dateFns.isAfter(data.validTimeLocal[hi], now) && (hour==start || ret.length>0) )  {
                  if ( targets.indexOf(hour)>=0 ) { // it is in our target list so record its index
                    ret.push(hi);
                  }
                }
                hi++;
              }
              // Short series (or an odd start hour) leaves gaps; fill them with
              // the next future hours so the slide still renders four columns.
              if (ret.length < 4) {
                for (var fi = 0; fi < data.validTimeLocal.length && ret.length < 4; fi++) {
                  if (ret.indexOf(fi) === -1 && dateFns.isAfter(data.validTimeLocal[fi], now)) {
                    ret.push(fi);
                  }
                }
                ret.sort(function(a,b){ return a - b; });
              }
              return ret;
            }
            function buildHourlyHeaderTitle(time) {
              var today = new Date(),
                tomorrow = dateFns.addDays(today, 1);
                sforecast = "'s Forecast";

              // title based on the first hour reported
              switch (dateFns.getHours(time)) {

                case 6: // 6 - Nextday's Forecast / Today's Forecast
              		// if 6am today
              		if (dateFns.isToday(time)) {
              			return dateFns.format(today, 'dddd') + sforecast;
              		}
              	case 0: // 0 - Nextday's Forecast
              		return dateFns.format(tomorrow, 'dddd') + sforecast;

              	case 12:
              		return 'This Afternoon';

              	case 15:
              		return "Today's Forecast";

              	case 17:
              		return "Tonight's Forecast";

              	case 20:
              		return dateFns.format(today, 'ddd') + ' Night/' + dateFns.format(tomorrow, 'ddd');

              }
            }

            weatherInfo.dayPart.lowerbar.daytitle = buildHourlyHeaderTitle(ajaxedLoc["v3-wx-forecast-hourly-2day"].validTimeLocal[indexes[0]])
            for (var hi = 0; hi < 4; hi++) {
              weatherInfo.dayPart.lowerbar.hour[hi].time = buildHourlyTimeTitle(ajaxedLoc["v3-wx-forecast-hourly-2day"].validTimeLocal[indexes[hi]])
              weatherInfo.dayPart.lowerbar.hour[hi].cond = ajaxedLoc["v3-wx-forecast-hourly-2day"].wxPhraseLong[indexes[hi]].replace('Scattered ', "Sct'd ").replace('Thunderstorms',"T'Storms").replace('Thundershowers',"T'Showers").replace('/',', ')
              weatherInfo.dayPart.lowerbar.hour[hi].icon = ajaxedLoc["v3-wx-forecast-hourly-2day"].iconCode[indexes[hi]]
              weatherInfo.dayPart.lowerbar.hour[hi].temp = ajaxedLoc["v3-wx-forecast-hourly-2day"].temperature[indexes[hi]]
              weatherInfo.dayPart.lowerbar.hour[hi].wind = ajaxedLoc["v3-wx-forecast-hourly-2day"].windDirectionCardinal[indexes[hi]] + ' ' + ajaxedLoc["v3-wx-forecast-hourly-2day"].windSpeed[indexes[hi]]
              weatherInfo.dayPart.lowerbar.hour[hi].windspeed= ajaxedLoc["v3-wx-forecast-hourly-2day"].windSpeed[indexes[hi]]
            }
            weatherInfo.dayPart.lowerbar.displayname = maincitycoords.displayname
          }
          //daydescANDfiveday
          if (ajaxedLoc["v3-wx-forecast-daily-5day"] == null) {
            weatherInfo.dayDesc.lowerbar.displayname = maincitycoords.displayname
            weatherInfo.dayDesc.lowerbar.noReport = true
            weatherInfo.fiveDay.lowerbar.displayname = maincitycoords.displayname
            weatherInfo.fiveDay.lowerbar.noReport = true
          } else {
            var daycorrection = 0;
            if (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) {
              daycorrection = 1;
            }
            //daydesc
            for (var hi = (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) ? 1 : 0; hi < 4 + daycorrection; hi++) {
              weatherInfo.dayDesc.lowerbar.day[hi - daycorrection].name = (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[hi].replace('Tomorrow', ajaxedLoc["v3-wx-forecast-daily-5day"].dayOfWeek[1]))
              weatherInfo.dayDesc.lowerbar.day[hi - daycorrection].desc = ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].narrative[hi] + ((ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].qualifierPhrase[hi] != null && ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].narrative[hi].includes(ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].qualifierPhrase[hi]) === false) ? ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].qualifierPhrase[hi] : '') + ((ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].windPhrase[hi - daycorrection] != null && ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].narrative[hi].includes(ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].windPhrase[hi]) === false) ? ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].windPhrase[hi] : '')
            }
            weatherInfo.dayDesc.lowerbar.displayname =  maincitycoords.displayname
            //fiveday
            var weatherLocsFD = {displayname:"",day:[{name:"",cond:"",icon:"",high:"",low:""},{name:"",cond:"",icon:"",high:"",low:""},{name:"",cond:"",icon:"",high:"",low:""},{name:"",cond:"",icon:"",high:"",low:""},{name:"",cond:"",icon:"",high:"",low:""}]};
            for (var hi = (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) ? 1 : 0, hidp = (ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].daypartName[0] == null) ? 2 : 0; hi < 5 + daycorrection; hi++, hidp = hidp + 2) {
              weatherInfo.fiveDay.lowerbar.day[hi - daycorrection].name = ajaxedLoc["v3-wx-forecast-daily-5day"].dayOfWeek[hi].substring(0,3)
              weatherInfo.fiveDay.lowerbar.day[hi - daycorrection].windspeed = ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].windSpeed[hidp]
              weatherInfo.fiveDay.lowerbar.day[hi - daycorrection].icon = ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].iconCode[hidp]
              weatherInfo.fiveDay.lowerbar.day[hi - daycorrection].cond = ajaxedLoc["v3-wx-forecast-daily-5day"].daypart[0].wxPhraseLong[hidp].replace('Scattered ', "Sct'd ").replace('Thunderstorms',"T'Storms").replace('Thundershowers',"T'Showers").replace('/',', ');
              weatherInfo.fiveDay.lowerbar.day[hi - daycorrection].high = ajaxedLoc["v3-wx-forecast-daily-5day"].temperatureMax[hi]
              weatherInfo.fiveDay.lowerbar.day[hi - daycorrection].low = ajaxedLoc["v3-wx-forecast-daily-5day"].temperatureMin[hi]
              weatherInfo.fiveDay.lowerbar.day[hi - daycorrection].weekend = ((dateFns.isWeekend(ajaxedLoc["v3-wx-forecast-daily-5day"].validTimeLocal[hi])) ? ' weekend' : '')
            }
            weatherInfo.fiveDay.lowerbar.displayname =  maincitycoords.displayname
          }
          //bulletin
          if (ajaxedLoc["v3alertsHeadlines"] != undefined){
            var displayday;
            var bulletintext = "";
            var ret = [], sret = [];
      			var ai=0;
      			//info
      			//get only weather alers
            for (ai=0; ai<=ajaxedLoc["v3alertsHeadlines"].alerts.length - 1; ai++) {
      				warning = ajaxedLoc["v3alertsHeadlines"].alerts[ai].categories[0].category;
      				if (warning == "Met")  {
      					ret.push({idx:ai, priority: getWarningPosition(ajaxedLoc["v3alertsHeadlines"].alerts[ai].eventDescription)})
      					if (ajaxedLoc["v3alertsHeadlines"].alerts[ai].eventDescription == "Severe Thunderstorm Warning" || ajaxedLoc["v3alertsHeadlines"].alerts[ai].eventDescription == "Flash Flood Warning" || ajaxedLoc["v3alertsHeadlines"].alerts[ai].eventDescription == "Tornado Warning") {
      						sret.push({idx:ai, priority:ajaxedLoc["v3alertsHeadlines"].alerts[ai].eventDescription})
      					}
      				}
      			};
      			if (ret.length != 0) {
      				ret.sort(function(a,b) {return a.priority - b.priority;});
                function pushAlert(aai) {
                  $.getJSON('https://api.weather.com/v3/alerts/detail?alertId='+ ajaxedLoc["v3alertsHeadlines"].alerts[ret[aai].idx].detailKey +'&format=json&language=en-US&apiKey=' + api_key, function(adata) {
                    var alertt = {name:"", desc:"", status:"", significance:""}
                    alertt.name = ajaxedLoc["v3alertsHeadlines"].alerts[ret[aai].idx].eventDescription
                    alertt.significance = ajaxedLoc["v3alertsHeadlines"].alerts[ret[aai].idx].significance
                    alertt.status = ((ajaxedLoc["v3alertsHeadlines"].alerts[ret[aai].idx].messageType == " Update") ? 'UPDATE' : (ajaxedLoc["v3alertsHeadlines"].alerts[ret[aai].idx].messageType == "Cancel") ? "CANCELLATION" : "")
                    alertt.desc = adata.alertDetail.texts[0].description
                    weatherInfo.bulletin.marqueewarnings.push(alertt)
                    if (aai < (ret.length - 1)) {pushAlert(aai + 1)};
                  });
                };
                pushAlert(0)
              }

              if (sret.length != 0) {
                weatherInfo.bulletin.severeweathermode = true;
        				sret.sort(function(a,b) {return a.priority - b.priority;});
                function pushSevereAlert(aai) {
                  $.getJSON('https://api.weather.com/v3/alerts/detail?alertId='+ ajaxedLoc["v3alertsHeadlines"].alerts[sret[aai].idx].detailKey +'&format=json&language=en-US&apiKey=' + api_key, function(sdata) {
                    var severewarn = {warningname:"", warningdesc:"", warningstatus:""}
                    severewarn.warningname = ajaxedLoc["v3alertsHeadlines"].alerts[sret[aai].idx].eventDescription
                    severewarn.warningstatus = ((ajaxedLoc["v3alertsHeadlines"].alerts[sret[aai].idx].messageType == "Update") ? 'UPDATE' : (ajaxedLoc["v3alertsHeadlines"].alerts[sret[aai].idx].messageType == "Cancel") ? "CANCELLATION" : "")
                    severewarn.warningdesc = sdata.alertDetail.texts[0].description
                    weatherInfo.bulletin.severewarnings.push(severewarn)
                    if (aai < (sret.length - 1)) {pushSevereAlert(aai + 1)};
                  });
                };
                pushSevereAlert(0)
              } else {
                weatherInfo.bulletin.severeweathermode = false;
              }
    };
  }
  // The sidebar and lower bar have something to paint from here, which is what
  // boot is really waiting for. Loops() reads these values once at construction
  // and then not again for five minutes, so starting it on the location alone
  // -- which resolves before this request has even been answered -- left the
  // temperature and the conditions icon blank on screen until that refresh came
  // round. Later calls from the refresh interval are a harmless no-op.
  bootDataReady.reach();
  }).fail(function() {
    weatherInfo.currentCond.sidebar.displayname = maincitycoords.displayname
    weatherInfo.currentCond.sidebar.noReport = true
    weatherInfo.dayPart.lowerbar.displayname = maincitycoords.displayname
    weatherInfo.dayPart.lowerbar.noReport = true
    weatherInfo.dayDesc.lowerbar.displayname = maincitycoords.displayname
    weatherInfo.dayDesc.lowerbar.noReport = true
    weatherInfo.fiveDay.lowerbar.displayname = maincitycoords.displayname
    weatherInfo.fiveDay.lowerbar.noReport = true
    // A no-report sidebar is still a display worth putting on screen.
    bootDataReady.reach();
  });
}
function grabalmanacSlidesData() {
  url = 'https://api.weather.com/v3/aggcommon/v3-wx-almanac-daily-1day;v3-wx-observations-current?geocode=' + maincitycoords.lat + ',' + maincitycoords.lon + "&format=json&language=en-US&units=e" + "&day=" + dateFns.format(new Date(), "D") + "&month=" + dateFns.format(new Date(),"M") + "&apiKey=" + api_key
    $.getJSON(url, function(data) {
      if (data == null) {
        weatherInfo.almanac.displayname = maincitycoords.displayname
        weatherInfo.almanac.noReport = true
      } else {
        weatherInfo.almanac.displayname = maincitycoords.displayname
        weatherInfo.almanac.date = dateFns.format(new Date(),"MMMM D")
        weatherInfo.almanac.avghigh = data["v3-wx-almanac-daily-1day"].temperatureAverageMax[0]
        weatherInfo.almanac.avglow = data["v3-wx-almanac-daily-1day"].temperatureAverageMin[0]
        weatherInfo.almanac.rechigh = data["v3-wx-almanac-daily-1day"].temperatureRecordMax[0]
        weatherInfo.almanac.reclow = data["v3-wx-almanac-daily-1day"].temperatureRecordMin[0]
        weatherInfo.almanac.rechighyear = data["v3-wx-almanac-daily-1day"].almanacRecordYearMax[0]
        weatherInfo.almanac.reclowyear = data["v3-wx-almanac-daily-1day"].almanacRecordYearMin[0]
        weatherInfo.almanac.sunset = dateFns.format(new Date(data["v3-wx-observations-current"].sunsetTimeLocal),"h:mm a")
        weatherInfo.almanac.sunrise = dateFns.format(new Date(data["v3-wx-observations-current"].sunriseTimeLocal),"h:mm a")
      }
    }).fail(function() {
      weatherInfo.almanac.displayname = maincitycoords.displayname
      weatherInfo.almanac.noReport = true
    });
    var phasesfound = 0;
    $.getJSON(`https://www.icalendar37.net/lunar/api/?lang=en&month=${dateFns.format(new Date(),"M")}&year=${dateFns.format(new Date(),"YYYY")}`, function(data) {
      console.log('test')
      for (phase in data.phase) {
        console.log(phasesfound)
        if (data.phase[phase].isPhaseLimit && phasesfound < 4 && phase > parseInt(dateFns.format(new Date(),"D"))) {
          weatherInfo.almanac.moonphases[phasesfound].name = {"new moon": "NEW", "first quarter": "FIRST", "full moon": "FULL", "last quarter": "LAST"}[(data.phase[phase].phaseName).toLowerCase()]
          weatherInfo.almanac.moonphases[phasesfound].date = String(data.monthName).slice(0,3) + " " + phase
          phasesfound += 1;
        }
      }
      if (phasesfound < 4) {
        nextMonth()
      }
    })
    function nextMonth() {
      $.getJSON(`https://www.icalendar37.net/lunar/api/?lang=en&month=${dateFns.format((dateFns.addMonths(new Date(),1)),"M")}&year=${dateFns.format(dateFns.addMonths(new Date(),1),"YYYY")}`, function(data) {
        for (phase in data.phase) {
          if (data.phase[phase].isPhaseLimit && phasesfound < 4) {
            console.log(phasesfound)
            weatherInfo.almanac.moonphases[phasesfound].name = {"new moon": "NEW", "first quarter": "FIRST", "full moon": "FULL", "last quarter": "LAST"}[(data.phase[phase].phaseName).toLowerCase()]
            weatherInfo.almanac.moonphases[phasesfound].date = String(data.monthName).slice(0,3) + " " + phase
            phasesfound += 1;
          }
        }
      })
    }
}
function grabHealthData() {
  $.getJSON('https://api.weather.com/v3/wx/forecast/daily/5day?geocode='+ maincitycoords.lat + ',' + maincitycoords.lon +"&format=json&language=en-US&units=e&apiKey=" + api_key, function(data) {
    var healthforecastdata = data
    var starthidx = 0;
    var starthidxdayonly = 0;
    if (healthforecastdata.daypart[0].daypartName[0] == undefined) {
      starthidx = 2;
      starthidxdayonly = 1;
      weatherInfo.healthforecast.dayidx = 2;
    }
    weatherInfo.healthforecast.displayname = maincitycoords.displayname
    weatherInfo.healthforecast.day = healthforecastdata.dayOfWeek[starthidxdayonly];
    weatherInfo.healthforecast.icon = healthforecastdata.daypart[0].iconCode[starthidx]
    weatherInfo.healthforecast.high = healthforecastdata.temperatureMax[starthidxdayonly]
    weatherInfo.healthforecast.low = healthforecastdata.temperatureMin[starthidxdayonly]
    weatherInfo.healthforecast.precipChance = healthforecastdata.daypart[0].precipChance[starthidx] + '%'
    weatherInfo.healthforecast.humid = healthforecastdata.daypart[0].relativeHumidity[starthidx] + '%'
    weatherInfo.healthforecast.wind = (((healthforecastdata.daypart[0].windDirectionCardinal[starthidx] == "CALM") ? 'calm' :  healthforecastdata.daypart[0].windDirectionCardinal[starthidx]) + ' ' + ((healthforecastdata.daypart[0].windSpeed[starthidx] === 0) ? '' : healthforecastdata.daypart[0].windSpeed[starthidx]))
    weatherInfo.healthforecast.windspeed = healthforecastdata.daypart[0].windSpeed[starthidx]
  });
  $.getJSON('https://api.weather.com/v1/geocode/'+ maincitycoords.lat + '/' + maincitycoords.lon + '/observations/pollen.json?language=en-US&apiKey=' + api_key, function(pollendata) {
    if (pollendata.pollenobservations !== undefined) {
    if (pollendata.pollenobservations[0].stn_cmnt != "No Report" && pollendata.pollenobservations[0].stn_cmnt != "Equipment Failure" && pollendata.pollenobservations[0].stn_cmnt != "Reports only during weed pollen season" && pollendata.pollenobservations[0].stn_cmnt != "Does not report year round" && pollendata.pollenobservations[0].stn_cmnt != "Reports Suspended") {
      if (pollendata.pollenobservations[0].total_pollen_cnt <= 9) {
        weatherInfo.healthPollen.totalcat = 'Low'
      } else if (pollendata.pollenobservations[0].total_pollen_cnt >= 10 && pollendata.pollenobservations[0].total_pollen_cnt <= 49) {
        weatherInfo.healthPollen.totalcat = 'Moderate'
      } else if (pollendata.pollenobservations[0].total_pollen_cnt >= 50 && pollendata.pollenobservations[0].total_pollen_cnt <= 499) {
        weatherInfo.healthPollen.totalcat = 'High'
      } else if (pollendata.pollenobservations[0].total_pollen_cnt >= 500) {
        weatherInfo.healthPollen.totalcat = 'Very High'
      };
        weatherInfo.healthPollen.total = pollendata.pollenobservations[0].total_pollen_cnt
        weatherInfo.healthPollen.types[0].treetype = ((pollendata.pollenobservations[0].treenames[0].tree_nm != "No Report") ? pollendata.pollenobservations[0].treenames[0].tree_nm : "")
        weatherInfo.healthPollen.date = dateFns.format(new Date(pollendata.pollenobservations[0].rpt_dt), "MMMM D")
        var pollentypes = ['tree', 'grass', 'weed', 'mold'];
        pollentypes.forEach((pollentype, i) => {
          weatherInfo.healthPollen.types[i].pollenidx = pollendata.pollenobservations[0].pollenobservation[i].pollen_idx
        });
    }
    }
  });
  $.getJSON('https://api.weather.com/v2/indices/achePain/daypart/3day?geocode=' + maincitycoords.lat + ',' + maincitycoords.lon + "&language=en-US&format=json&apiKey=" + api_key, function(data) {
    var achesindexdata = data
    var startidx = 0;
    if (achesindexdata.achesPainsIndex12hour.dayInd[0] == 'N') {
      startidx = 1;
    }
    weatherInfo.healthAcheBreath.achesindex = achesindexdata.achesPainsIndex12hour.achesPainsIndex[startidx]
    weatherInfo.healthAcheBreath.achescat = achesindexdata.achesPainsIndex12hour.achesPainsCategory[startidx]
    weatherInfo.healthAcheBreath.date = dateFns.format(new Date(achesindexdata.achesPainsIndex12hour.fcstValidLocal[0]), "dddd")
  });
  $.getJSON('https://api.weather.com/v2/indices/breathing/daypart/3day?geocode=' + maincitycoords.lat + ',' + maincitycoords.lon + "&language=en-US&format=json&apiKey=" + api_key, function(data) {
    var breathindexdata = data
    var startidx = 0;
    if (breathindexdata.breathingIndex12hour.dayInd[0] == 'N') {
      startidx = 1;
    }
    weatherInfo.healthAcheBreath.breathindex = breathindexdata.breathingIndex12hour.breathingIndex[startidx]
    weatherInfo.healthAcheBreath.breathcat = breathindexdata.breathingIndex12hour.breathingCategory[startidx]
  });
  $.getJSON('https://api.weather.com/v3/wx/globalAirQuality?geocode=' + maincitycoords.lat + ',' + maincitycoords.lon + "&language=en-US&scale=EPA&format=json&apiKey=" + api_key, function(data) {
    var airqualitydata = data
    weatherInfo.airquality.airqualityindex = airqualitydata.globalairquality.airQualityCategoryIndex
    weatherInfo.airquality.primarypolute = (airqualitydata.globalairquality.primaryPollutant).replace('PM10','Fine Particulate').replace('PM2.5','Fine Particulate').replace('O3','Ozone')
    weatherInfo.airquality.date = dateFns.format(new Date(airqualitydata.globalairquality.expireTimeGmt * 1000), "dddd")
  });
  $.getJSON('https://api.weather.com/v2/indices/uv/current?geocode=' + maincitycoords.lat + ',' + maincitycoords.lon + "&language=en-US&format=json&apiKey=" + api_key, function(data) {
    var uvData = data
    weatherInfo.uvindex.currentuv.index = uvData.uvIndexCurrent.uvIndex
    weatherInfo.uvindex.currentuv.desc = uvData.uvIndexCurrent.uvDesc
  });
  $.getJSON('https://api.weather.com/v2/indices/uv/hourly/48hour?geocode=' + maincitycoords.lat + ',' + maincitycoords.lon + "&language=en-US&format=json&apiKey=" + api_key, function(data) {
    var uvData = data
    var indexes = calcHourlyReport(uvData.uvIndex1hour);
    var i;
    for (var i = 0; i < 3; i++) {
      weatherInfo.uvindex.forecast[i].day = dateFns.format(new Date(uvData.uvIndex1hour.fcstValidLocal[indexes[i]]), 'ddd')
      weatherInfo.uvindex.forecast[i].time = buildHourlyTimeTitle(uvData.uvIndex1hour.fcstValidLocal[indexes[i]])
      weatherInfo.uvindex.forecast[i].index = uvData.uvIndex1hour.uvIndex[indexes[i]]
      weatherInfo.uvindex.forecast[i].desc = uvData.uvIndex1hour.uvDesc[indexes[i]]
    }

    //get reporting hours: 6am, 12pm, 3pm
    function buildHourlyTimeTitle(time){
      var hour=dateFns.getHours(time);
      return (dateFns.format(time,'h a')).replace(" ", "");
    }
    function calcHourlyReport(data) {
      var hret = [],
        targets = [9, 12, 15],   // hours that we report
        current = dateFns.getHours(new Date()),
        now = new Date(),
        //firsthour = targets[ getNextHighestIndex(targets, current) ],
        start,
        hour, i=0;
      switch (true) {
        case (current < 6):
          start = 9;
        case (current < 9):
          start = 12; break;
        case (current < 12):
          start = 15; break;
        case (current < 13):
          start = 9; break;
        default:
          start = 9;
      }
      // Bounded for the same reason as the hourly scan above.
      while(hret.length<3 && i < data.fcstValidLocal.length){

        // hour must be equal or greater than current
        hour = dateFns.getHours(data.fcstValidLocal[i] );
        if ( dateFns.isAfter(data.fcstValidLocal[i], now) && (hour==start || hret.length>0) )  {

          if ( targets.indexOf(hour)>=0 ) { // it is in our target list so record its index
            hret.push(i);
          }

        }
        i++;
      }
      if (hret.length < 3) {
        for (var uvi = 0; uvi < data.fcstValidLocal.length && hret.length < 3; uvi++) {
          if (hret.indexOf(uvi) === -1 && dateFns.isAfter(data.fcstValidLocal[uvi], now)) {
            hret.push(uvi);
          }
        }
        hret.sort(function(a,b){ return a - b; });
      }
      return hret;
    }
  })
}
function grabAirportDelayData() {
    $.getJSON('http://'+document.location.hostname+':8081/https://nasstatus.faa.gov/api/airport-events', function(eventdata) {
      for (const airportevent of eventdata) {
        var airportdelay = {iata:"",type:"",amount:"",reason:""}
        if (airportevent.airportClosure) {
          airportdelay.iata = airportevent.airportId
          airportdelay.type = 'Closure'
          airportdelay.amount = 'Closed'
          airportdelay.amountmin = 99999999999999999999999999999999999999999999999999
          airportdelay.reason = ''
          weatherInfo.airport.delays.push(airportdelay)
        }
        if (airportevent.arrivalDelay) {
          airportdelay.iata = airportevent.airportId
          airportdelay.type = 'Arrival'
          airportdelay.amount = formatMinutes(airportevent.arrivalDelay.averageDelay)
          airportdelay.amountmin = airportevent.arrivalDelay.averageDelay
          airportdelay.reason = airportevent.arrivalDelay.reason
          weatherInfo.airport.delays.push(airportdelay)
        }
        if (airportevent.departureDelay) {
          airportdelay.iata = airportevent.airportId
          airportdelay.type = 'Departure'
          airportdelay.amount = formatMinutes(airportevent.departureDelay.averageDelay)
          airportdelay.amountmin = airportevent.departureDelay.averageDelay
          airportdelay.reason = airportevent.departureDelay.reason
          weatherInfo.airport.delays.push(airportdelay)
        }
        if (airportevent.groundDelay) {
          airportdelay.iata = airportevent.airportId
          airportdelay.type = 'Arrival'
          airportdelay.amount = formatMinutes(airportevent.groundDelay.avgDelay)
          airportdelay.amountmin = airportevent.groundDelay.avgDelay
          airportdelay.reason = airportevent.groundDelay.impactingCondition
          weatherInfo.airport.delays.push(airportdelay)
        }
        if (airportevent.groundStop) {
          airportdelay.iata = airportevent.airportId
          airportdelay.type = 'Arrival'
          airportdelay.amount = 'until...'
          airportdelay.reason = airportevent.groundStop.impactingCondition
          weatherInfo.airport.delays.push(airportdelay)
        }
      };
      grabAirportData()
    })
}
grabAirportDelayData()
function grabAirportData() {
  var mairporturl = 'https://api.weather.com/v3/aggcommon/v3-location-point;v3-wx-observations-current?iataCodes='
  for (var i = 0; i < weatherInfo.airport.mainairports.length; i++) {
    mairporturl += weatherInfo.airport.mainairports[i].iata + ';'
  }
  mairporturl += '&language=en-US&units=e&format=json&apiKey='+ api_key
  //{displayname:"New York / LaGaurdia",iata:"LGA",delay:"No Delay",temp:""}
  $.getJSON(mairporturl, function(data) {
    weatherInfo.ccticker.ccairportdelays = []
    data.forEach((airport, i) => {
      if (!airport || !airport['v3-location-point'] || !airport['v3-wx-observations-current']) { return; }
      var marqueedelay = {iato:"",type:"",amount:"",amountmin:0,reason:""};
      var airportdepartdelay = {iato:"",type:"",amount:"",amountmin:0,reason:""};
      var airportarrivaldelay = {iato:"",type:"",amount:"",amountmin:0,reason:""};
      var marqueeairport = {displayname:"",iata:"LGA",delay:"No Delay",temp:"",cond:""}
      weatherInfo.airport.mainairports[i].displayname = airport['v3-location-point'].location.airportName
      weatherInfo.airport.mainairports[i].temp = airport['v3-wx-observations-current'].temperature
      weatherInfo.airport.mainairports[i].cond = airport['v3-wx-observations-current'].wxPhraseLong
      weatherInfo.airport.mainairports[i].icon = airport['v3-wx-observations-current'].iconCode
      weatherInfo.airport.mainairports[i].windspeed = airport['v3-wx-observations-current'].windSpeed
      marqueeairport.displayname = airport['v3-location-point'].location.airportName
      marqueeairport.temp = airport['v3-wx-observations-current'].temperature
      marqueeairport.cond = airport['v3-wx-observations-current'].wxPhraseLong.toLowerCase();
      marqueeairport.iata = weatherInfo.airport.mainairports[i].iata
      for (const delay of weatherInfo.airport.delays) {
        if (delay.iata == weatherInfo.airport.mainairports[i].iata) {
          if (delay.amountmin > marqueedelay.amountmin) {
            marqueedelay = delay
            marqueeairport.delay = (delay.amount).replace('<em>','').replace('</em>','')
          }
          if (delay.type == 'Arrival') {
            if (delay.amountmin > airportarrivaldelay.amountmin) {
              airportarrivaldelay = delay
              weatherInfo.airport.mainairports[i].arrivals.delay = delay.amount
              weatherInfo.airport.mainairports[i].arrivals.reason = delay.reason
            }
          } else if (delay.type == 'Departure') {
            if (delay.amountmin > airportdepartdelay.amountmin) {
              airportdepartdelay = delay
              weatherInfo.airport.mainairports[i].departures.delay = delay.amount
              weatherInfo.airport.mainairports[i].departures.reason = delay.reason
            }
          } else if (delay.type == 'Closure'){
            airportdepartdelay = delay
            airportarrivaldelay = delay
            weatherInfo.airport.mainairports[i].arrivals.delay = 'Closed'
            weatherInfo.airport.mainairports[i].departures.delay = 'Closed'
          }
        }
      };
      weatherInfo.ccticker.ccairportdelays.push(marqueeairport)
    });
  });

  //otherairport
  var oairporturl = 'https://api.weather.com/v3/aggcommon/v3-wx-observations-current?iataCodes='
  for (var i = 0; i < weatherInfo.airport.otherairports.length; i++) {
    oairporturl += weatherInfo.airport.otherairports[i].iata + ';'
  }
  oairporturl += '&language=en-US&units=e&format=json&apiKey='+ api_key
  $.getJSON(oairporturl, function(data) {
    data.forEach((airport, i) => {
      if (!airport || !airport['v3-wx-observations-current']) { return; }
      var airportdelays = {iato:"",type:"",amount:"",amountmin:0,reason:""};
      weatherInfo.airport.otherairports[i].temp = airport['v3-wx-observations-current'].temperature
      weatherInfo.airport.otherairports[i].icon = airport['v3-wx-observations-current'].iconCode
      weatherInfo.airport.otherairports[i].windspeed = airport['v3-wx-observations-current'].windSpeed
      weatherInfo.airport.delays.forEach((delay, delayi) => {
        if (delay.iata == weatherInfo.airport.otherairports[i].iata) {
          if (delay.amountmin > airportdelays.amountmin) {
            airportdelays = delay
            weatherInfo.airport.otherairports[i].delay = delay.amount
          }
        }
      });
    });
  });
}

function pullCCTickerData() {
  var ccurl = 'https://api.weather.com/v3/aggcommon/v3-wx-forecast-daily-5day;v3-wx-observations-current;v3-location-point?geocodes=';
  // ajax the latest observation
  if (ccTickerCitiesList.length != 0) {
    ccTickerCitiesList.forEach((loc, i) => {
      ccurl += `${loc.lat},${loc.lon};`
    });
    ccurl += '&language=en-US&units=e&format=json&apiKey='+ api_key
  } else {
    ccurl = 'https://api.weather.com/v3/aggcommon/v3-wx-forecast-daily-5day;v3-wx-observations-current;v3-location-point?geocodes=41.881832,-87.623177;44.986656,-93.258133;33.427204,-111.939896;46.877186,-96.789803;34.187042,-118.381256;33.660057,-117.998970;36.114647,-115.172813;21.315603,-157.858093;28.538336,-81.379234;43.0,-75.0;&language=en-US&units=e&format=json&apiKey='+ api_key
  }
  weatherInfo.ccticker.ccLocs = [];
  $.getJSON(ccurl, function(data) {
        data.forEach((locationdata, i) => {
          if (!locationdata || !locationdata['v3-wx-observations-current'] ||
              !locationdata['v3-wx-forecast-daily-5day'] || !locationdata['v3-location-point']) { return; }
          var ccLoc = {displayname:"",currentCond:{cond:"",temp:""},forecast:{cond:"",temp:""}}
          var marqueeidx = 1;
          if (locationdata['v3-wx-forecast-daily-5day'].daypart[0].daypartName[0] == undefined) {marqueeidx = 2;};
          if (locationdata['v3-wx-forecast-daily-5day'].daypart[0].daypartName[marqueeidx] == "Tonight") {weatherInfo.ccticker.arrow = 'tonight';} else {weatherInfo.ccticker.arrow = (locationdata['v3-wx-forecast-daily-5day'].dayOfWeek[1].substring(0,3)).toLowerCase()};
          ccLoc.displayname = locationdata['v3-location-point'].location.displayName + ': '
          ccLoc.currentCond.temp = locationdata['v3-wx-observations-current'].temperature
          ccLoc.currentCond.cond = (locationdata['v3-wx-observations-current'].wxPhraseLong).toLowerCase()
          ccLoc.forecast.temp = locationdata['v3-wx-forecast-daily-5day'].daypart[0].temperature[marqueeidx]
          ccLoc.forecast.cond = (locationdata['v3-wx-forecast-daily-5day'].daypart[0].wxPhraseLong[marqueeidx]).toLowerCase()
          weatherInfo.ccticker.ccLocs.push(ccLoc)
        });
        // Render as soon as the data lands rather than waiting for the marquee's
        // own five-minute refresh.
        if (typeof window.refreshCCTicker === 'function') { window.refreshCCTicker(); }
      });
  };
//loop data collection, slide loops data functions is done based on full cycle
setInterval(function(){
  grabSideandLowerBarData();
  pullCCTickerData();
}, 300000)

/**
 * Boot runs on readiness now, not on a stopwatch.
 *
 * Everything used to start from a bare setTimeout(4000) — "init 1 second before
 * intro stops" — so seven map instances, the slide engine, the sidebar loops
 * and the ticker manager all landed in the same moment the intro card lifts and
 * the display becomes visible. That is the worst possible moment for it: the
 * ticker is scrolling in front of the viewer by then, and it is the first thing
 * a blocked main thread shows.
 *
 * It was also wrong on its own terms. The maps centre on maincitycoords, and
 * nothing tied that timer to the location lookup having landed — a slow or
 * retrying lookup built every map around empty coordinates.
 *
 * The intro runs five seconds and the location resolves in well under one, so
 * there are four idle seconds behind the card with nothing on screen but a
 * spinning logo. The warmup goes there. Only the slide rotation waits for the
 * reveal, so the first slide a viewer sees starts at its first frame instead of
 * being a second old already.
 */
var loops, slides;

// Warmup, behind the intro card, while nothing the viewer can see is moving.
bootDataReady.then(function () {
  initSidebarBasemaps();
  loops = new Loops();
  MarqueeMan();
  preloadRevealAssets();
});

// How long after the reveal to leave the display alone before building the
// four surfaces nobody is looking at yet. The first radar slide is around
// forty seconds into the loop -- an intro, current conditions and the city
// panel ahead of it -- so this has room to spare, and the radar slides build
// them on demand if it somehow does not.
//
// The settle is the point. requestIdleCallback on its own fired 450ms after the
// reveal, because the browser genuinely was idle then; measured, that put four
// WebGL contexts and their style downloads squarely into the moment this whole
// change exists to keep clear.
var SLIDE_MAP_SETTLE_MS = 12000;

bootRevealed.then(function () {
  slides = new Slides();
  setTimeout(function () { whenIdle(initSlideBasemaps, 10000); }, SLIDE_MAP_SETTLE_MS);
});

/**
 * Run fn at the next idle moment, and no later than `timeout`.
 *
 * The hard timer is set even where requestIdleCallback exists, rather than as
 * a fallback for where it does not: a display parked in a background tab may
 * be given no idle callbacks at all, and these surfaces have to exist before
 * the first radar slide either way. fn is idempotent, so whichever fires first
 * wins and the other is a no-op.
 */
function whenIdle(fn, timeout) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, {timeout: timeout});
  setTimeout(fn, timeout);
}

/**
 * Fetch what the first slides paint before they are asked to paint it.
 *
 * The city background is a 300–400KB PNG assigned to a container that is
 * display:none until its slide shows, so the browser does not request it until
 * the first transition — measured, it landed about a second and a half after
 * the reveal and decoded over the top of the slide that wanted it. Behind the
 * intro card both the network and the image decoder are idle, so this is free.
 */
function preloadRevealAssets() {
  var theme = apperanceSettings.corebackgroud;
  var known = ['forest', 'ocean', 'mountain', 'city', 'neighborhood', 'southwest'];
  var core = (known.indexOf(theme) === -1) ? '/images/newbg/core_bg.png'
    : '/images/newbg/core_' + theme + '_bg.png';
  [core, '/images/newbg/map_banner_bg.png'].forEach(function (url) {
    var img = new Image();
    img.decoding = 'async';
    img.src = url;
  });
}

function simulateReboot() {
  weatherInfo.reboot = true
  setTimeout(function () {
    $("#info-slides-bg").hide()
    $("#template").hide()
    $("#logo-area").hide()
    $("#marquee2").hide()
    setTimeout(function () {
      $("#info-slides-container").hide()
      $("#date-time").hide()
      $("#city").hide()
      $("#conditions-icon").hide()
      $("#current-conditions").hide()
      $("#minimap-title").hide()
      $("#minimap").hide()
    }, 250)
    setTimeout(function () {
      window.location.reload();
    }, (Math.floor(Math.random() * (20000 - 10000 + 1)) + 10000))
  }, (Math.floor(Math.random() * (45000 - 30000 + 1)) + 30000))
}
