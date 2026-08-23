var noreportmodecc = false, noreportmodefc = false, noreportmodeac = false;
var marqueeforecasttype = 'forecast'
//do audio thing and second marquee
$(function(){
	weatherAudio.playCallback = function(tags) {
		$('.track-info').text('playing "' + tags.title + '" by ' + tags.artist);
	}
	loadMarqueeItems().then(function () {
		switchMarquee2(0);
	});
	// Long-running displays should not sit on a stale headline set.
	setInterval(loadMarqueeItems, marqueeRefreshMs);
});
// Lower ticker. Content comes from /api/marquee, which merges whatever RSS,
// Atom or JSON feeds are configured in MARQUEE_FEEDS. The hardcoded strings in
// config.js are only a fallback for when no feed is set or every feed fails.
var marqueeItems = [];
var marqueeRefreshMs = 15 * 60 * 1000;

function fallbackMarqueeItems() {
	var ads = (typeof apperanceSettings !== 'undefined' && apperanceSettings.marqueeAd) || [];
	return ads.filter(function (t) { return typeof t === 'string' && t.trim(); });
}

function loadMarqueeItems() {
	return fetch('/api/marquee', {credentials: 'same-origin'})
		.then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
		.then(function (data) {
			var items = (data.items || [])
				.map(function (i) { return i.text; })
				.filter(function (t) { return typeof t === 'string' && t.trim(); });
			if (items.length) marqueeItems = items;
			return marqueeItems;
		})
		.catch(function (err) {
			console.warn('[marquee] feed unavailable, using fallback:', err.message);
			return marqueeItems;
		});
}

function switchMarquee2(idx) {
	var items = marqueeItems.length ? marqueeItems : fallbackMarqueeItems();
	if (!items.length) return;
	// Guard the index: the original compared against length rather than
	// length - 1, so every cycle ended by rendering "undefined".
	if (idx >= items.length || idx < 0) idx = 0;

	$('#marquee2').marquee('destroy');
	$('#marquee2').text(items[idx]);
	$('#marquee2')
		.marquee({speed: 170, pauseOnHover: true})
		.on('finished', function () {
			var next = idx + 1;
			// Pick up newly published headlines when the loop comes back around.
			if (next >= items.length) {
				loadMarqueeItems().then(function () { switchMarquee2(0); });
				return;
			}
			switchMarquee2(next);
		});
}
function MarqueeMan() {
	function switchToWarningMarquee(sidx) {
		if (weatherInfo.bulletin.severewarnings.length != 0) {
			$('#marqueeSevere').css("background","linear-gradient(to right, #510d08 0, #b41a08 100%)")
			$('.marqueeheadersevere').css("background","linear-gradient(to right, #d51e08 0, #b41a08 100%)")
			$('.marqueeheadersevere').css("color","#DDDDDD")
			$('.marqueeheadersevere').css("text-shadow","2px 2px 4px #000")

			$('.marqueeheadersevere').text((weatherInfo.bulletin.severewarnings[sidx].warningname).toUpperCase() + ' ' + weatherInfo.bulletin.severewarnings[sidx].warningstatus);
			$('#arrow-img').fadeOut(0)
			$('#marqueeSevere').fadeIn(0)
			$('.marqueeheadersevere').fadeIn(0) //#868686
			$('#marqueeSevere').text(weatherInfo.bulletin.severewarnings[sidx].warningdesc)
			weatherAudio.playwarningbeep()
			setTimeout(function()
			{
				if (weatherInfo.bulletin.severewarnings[sidx].warningname == "SEVERE THUNDERSTORM WARNING") {
					weatherAudio.severeWarning()
				} else if (weatherInfo.bulletin.severewarnings[sidx].warningname == "TORNADO WARNING") {
					weatherAudio.tornadoWarning()
				} else if (weatherInfo.bulletin.severewarnings[sidx].warningname == "FLASH FLOOD WARNING") {
					weatherAudio.flashFloodWarning()
				}
			},3500)
			//weatherAudio.severeWarning()
			$('#marqueeSevere')
				.marquee('destroy')
				.marquee({speed: 170, delayBeforeStart: 1000, pauseOnHover: true, pauseOnCycle: true})
				.on('finished', function(){
					switchToWarningMarquee(((sidx < weatherInfo.bulletin.severewarnings.length -1) ? sidx + 1 : 0))
				})
		} else if (weatherInfo.bulletin.marqueewarnings.length != 0){
			if (weatherInfo.bulletin.severeweathermode == true) {
				$('#marqueeSevere').css("background","linear-gradient(to right, #510d08 0, #b41a08 100%)")
				$('.marqueeheadersevere').css("background","linear-gradient(to right, #d51e08 0, #b41a08 100%)")
				$('.marqueeheadersevere').css("color","#DDDDDD")
				$('.marqueeheadersevere').css("text-shadow","2px 2px 4px #000")
				weatherAudio.playwarningbeep()
			}	else if (weatherInfo.bulletin.marqueewarnings[0].significance == "Y" || weatherInfo.bulletin.marqueewarnings[0].significance == "S") {
				$('#marqueeSevere').css('background','linear-gradient(to right, #874901 0, #bb631a 100%)')
				$('.marqueeheadersevere').css("background","linear-gradient(to right, #f2992e 0, #bb631a 100%)")
				$('.marqueeheadersevere').css("color","#000")
				$('.marqueeheadersevere').css("text-shadow", "0px 0px 0px #000")
			} else if (weatherInfo.bulletin.marqueewarnings[0].significance == "A") {
				$('#marqueeSevere').css("background", "linear-gradient(to right, #846811 0, #9b7d0e 100%)");
				$('.marqueeheadersevere').css('background', 'linear-gradient(to right, #e5dd20 0, #9b7d0e 100%)');
				$('.marqueeheadersevere').css("color", "#000");
				$('.marqueeheadersevere').css("text-shadow", "0px 0px 0px #000");
			}	else if (weatherInfo.bulletin.marqueewarnings[0].significance == "W") {
				$('#marqueeSevere').css("background","linear-gradient(to right, #510d08 0, #b41a08 100%)")
				$('.marqueeheadersevere').css("background","linear-gradient(to right, #d51e08 0, #b41a08 100%)")
				$('.marqueeheadersevere').css("color","#DDDDDD")
				$('.marqueeheadersevere').css("text-shadow","2px 2px 4px #000")
			}
			$('.marqueeheadersevere').text((weatherInfo.bulletin.marqueewarnings[0].name).toUpperCase() + ' ' + weatherInfo.bulletin.marqueewarnings[0].status)
			$('#arrow-img').fadeOut(0)
			$('#marqueeSevere').fadeIn(0)
			$('.marqueeheadersevere').fadeIn(0)
			$('#marqueeSevere').text(weatherInfo.bulletin.marqueewarnings[0].desc)
			$('#marqueeSevere')
				.marquee({speed: 170, delayBeforeStart: 1000, pauseOnHover: true, pauseOnCycle: true})
				.on('finished', function(){	if (weatherInfo.bulletin.severeweathermode == true) {weatherAudio.playwarningbeep()}})

		} else {
			$('#marqueeSevere')
				.marquee('destroy')
			$('#marqueeSevere').fadeOut(0)
			$('.marqueeheadersevere').fadeOut(0)
			$('#arrow-img').fadeIn(0)
		}

	}
		// for ccticker
		function displayCCTickerData() {
			var $span,$spanfor,$spanair;
			// ajax the latest observation
			$(".marquee-current").remove()
			$(".marquee-fore").remove()
			$(".marquee-airport").remove()
			if (weatherInfo.ccticker.noReportCC == true) {
				noreportmodecc = true
			} else {noreportmodecc == false}
			if (weatherInfo.ccticker.noReportFC == true) {
				noreportmodefc = true
			} else {noreportmodefc == false}
			if (weatherInfo.ccticker.noReportAC == true) {
				noreportmodeac = true
			} else {noreportmodeac == false}
			weatherInfo.ccticker.ccLocs.forEach((ccLoc, i) => {
				$span = $("<span class=marquee-current id='" + "cclocation" + i + "'></span>").appendTo('#marquee-now');
				$spanfor = $("<span class=marquee-fore id='" + "cclocation" + i + "'></span>").appendTo('#marquee-now');
				$span.text(ccLoc.displayname + ((noreportmodecc == true) ? "" : ccLoc.currentCond.temp + ' ' + ccLoc.currentCond.cond));
				$spanfor.css('display','none')
				$span.css('display','none')
				$spanfor.text(ccLoc.displayname + ((noreportmodefc == true) ? "" : ccLoc.forecast.temp  + ' ' + ccLoc.forecast.cond));
			});
			weatherInfo.ccticker.ccairportdelays.forEach((ccAirLoc, i) => {
				$spanair = $("<span class=marquee-airport id='" + "aclocation" + i + "'></span>").appendTo('#marquee-now');
				$spanair.css('display','none')
				$spanair.text((ccAirLoc.displayname).replace('International',"Int'l")+ ': ' + ((noreportmodeac == true) ? "" : ccAirLoc.temp + ' ' + ccAirLoc.cond + ', ' + ccAirLoc.delay));
			});
		};

		function refreshMarquee (idx) {
			var currentDisplay,
				displays = {
					marqueeairport() {
						$('.track-info').show()
						$('#arrow-img').attr("src",'/images/now.png');
						$('.marquee-fore').each(function(i, item) {
							item.style.display = 'none'
						});
						$('.marquee-airport').each(function(i, item) {
							item.style.display = ''
						});
						$('.marquee-current').each(function(i, item) {
							item.style.display = 'none'
						});
					}
					,marqueecurrent() {
						$('#arrow-img').attr("src",'/images/now.png');
						$('.track-info').hide()
						$('.marquee-fore').each(function(i, item) {
							item.style.display = 'none'
						});
						$('.marquee-airport').each(function(i, item) {
							item.style.display = 'none'
						});
						$('.marquee-current').each(function(i, item) {
							item.style.display = ''
						});
					}
					,marqueeforecast() {
						$('.track-info').hide()
						if (noreportmodefc == false) {
							$('#arrow-img').attr("src",'/images/' + weatherInfo.ccticker.arrow + 'arrow.png');
						} else {
							$('#arrow-img').attr("src",'/images/arrow.png');
						}
						marqueeforecasttype = 'forecast'
						$('.marquee-fore').each(function(i, item) {
							item.style.display = ''
						});
						$('.marquee-current').each(function(i, item) {
							item.style.display = 'none'
						});
						$('.marquee-airport').each(function(i, item) {
							item.style.display = 'none'
						});
					}
				}
				keys = Object.keys(displays);
				if (noreportmodeac == true && idx == 0) {idx == 1}
				if (noreportmodecc == true && idx == 1) {idx == 2}
				currentDisplay = displays[keys[idx]];
				currentDisplay();
				$('#marquee-container')
					.marquee('destroy')
					.marquee({speed: 200, pauseOnHover:true, delayBeforeStart:1000})
					.on('finished', function() {refreshMarquee(((idx < 2) ? ++idx : 0))});
		}
		//init and loop the things
		refreshMarquee(0);
		switchToWarningMarquee(0);
		displayCCTickerData();
		setInterval(function(){
			displayCCTickerData();
			switchToWarningMarquee();
		}, 300000)
}
