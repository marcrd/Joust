/// <reference path="../typings/index.d.ts"/>
/// <reference path="./global.d.ts"/>

import {GameWidgetProps, CardData, JoustEventHandler, QueryCardMetadata} from "./interfaces";
import Application from "./components/Joust";
import GameWidget from "./components/GameWidget";
import GameStateSink from "./state/GameStateSink";
import GameStateTracker from "./state/GameStateTracker";
import HSReplayDecoder from "./protocol/HSReplayDecoder";
import GameStateScrubber from "./state/GameStateScrubber";
import * as http from "http";
import * as https from "https";
import * as URL from "url";
import TexturePreloader from "./TexturePreloader";
import {EventEmitter} from "events";
import * as async from "async";

var React = require('react');
var ReactDOM = require('react-dom');

class Launcher {

	protected target:string | HTMLElement;
	protected opts:GameWidgetProps;
	protected queryCardMetadata:QueryCardMetadata;
	protected startFromTurn:number;
	protected turnCb:(turn:number) => void;
	protected pause:boolean;
	protected ref:GameWidget;

	constructor(target:any) {
		this.target = target;
		this.opts = {
			debug: false,
			logger: (error:Error):void => {
				let message = error.message ? error.message : error;
				console.error(message);
			}
		} as any;
		this.opts.assetDirectory = (asset) => "assets/" + asset;
		this.opts.cardArtDirectory = (cardId) => "https://static.hsreplay.net/static/joust/card-art/" + cardId + ".jpg";
	}

	public width(width:number):Launcher {
		this.opts.width = width;
		return this;
	}

	public height(height:number):Launcher {
		this.opts.height = height;
		return this;
	}

	public assets(assets:string|((asset:string) => string)):Launcher {
		let cb = null;
		if (typeof assets === "string") {
			cb = (asset:string) => assets + asset;
		}
		else {
			cb = assets;
		}
		this.opts.assetDirectory = cb;
		return this;
	}

	public textures(a:any):Launcher {
		console.warn('Launcher.textures() is no longer in use, use .cardArt() instead');
		return this;
	}

	public cardArt(url:string|((cardId:string) => string)):Launcher {
		let cb = null;
		if (typeof url === "string") {
			cb = (cardId:string) => url + cardId + ".jpg";
		}
		else {
			cb = url;
		}
		this.opts.cardArtDirectory = cb;
		return this;
	}

	public metadata(query:QueryCardMetadata):Launcher {
		this.queryCardMetadata = query;
		return this;
	}

	public setOptions(opts:any):Launcher {
		for (var prop in opts) {
			this.opts[prop] = opts[prop];
		}
		return this;
	}

	public onTurn(callback:(turn:number) => void):Launcher {
		this.turnCb = callback;
		return this;
	}

	public onToggleReveal(callback:(reveal:boolean) => void):Launcher {
		this.opts.onToggleReveal = callback;
		return this;
	}

	public onToggleSwap(callback:(swap:boolean) => void):Launcher {
		this.opts.onToggleSwap = callback;
		return this;
	}

	public startPaused(paused?:boolean):Launcher {
		this.pause = typeof paused === "undefined" ? true : !!paused;
		return this;
	}

	public startAtTurn(turn:number):Launcher {
		this.startFromTurn = turn;
		return this;
	}

	public startRevealed(reveal:boolean):Launcher {
		this.opts.startRevealed = reveal;
		return this;
	}

	public startSwapped(swap:boolean):Launcher {
		this.opts.startSwapped = swap;
		return this;
	}

	public logger(logger:(message:string | Error) => void):Launcher {
		this.opts.logger = logger;
		return this;
	}

	public events(cb:JoustEventHandler):Launcher {
		this.opts.events = cb;
		this.track("init", {count: 1});
		return this;
	}

	public debug(enable?:boolean):Launcher {
		if (typeof enable === 'undefined' || enable === null) {
			enable = true;
		}
		this.opts['debug'] = enable;
		return this;
	}

	protected log(message:any):void {
		this.opts.logger(message);
	}

	protected track(event:string, values:Object, tags?:Object):void {
		if (!this.opts.events) {
			return;
		}
		if (!tags) {
			tags = {};
		}
		this.opts.events(event, values, tags);
	}

	public get replayDuration():number {
		return this.opts.scrubber.getDuration();
	}

	public get secondsWatched():number {
		return (this.opts.scrubber as GameStateScrubber).secondsWatched;
	}

	public get percentageWatched():number {
		return (this.opts.scrubber as GameStateScrubber).percentageWatched;
	}

	public fromUrl(url:string):void {
		var decoder = new HSReplayDecoder();
		decoder.debug = this.opts.debug;
		var tracker = new GameStateTracker();
		var scrubber = new GameStateScrubber(null, this.startFromTurn);
		if (this.turnCb) {
			scrubber.on("turn", this.turnCb);
		}
		var sink = new GameStateSink();
		var preloader = new TexturePreloader(this.opts.cardArtDirectory, this.opts.assetDirectory);
		if (preloader.canPreload()) {
			preloader.consume();
		}

		if (url.match(/^\//) && location && location.protocol) {
			let old = url;
			url = location.protocol + url;
		}
		var opts = URL.parse(url) as any;
		opts.withCredentials = false;
		(opts.protocol == 'https:' ? https : http).get(opts, (message:http.IncomingMessage) => {
			let success = (message.statusCode == 200);
			this.track("replay_load_error", {error: success ? "f" : "t"}, {statusCode: message.statusCode});
			if (!success) {
				this.log(new Error('Could not load replay (status code ' + message.statusCode + ')'));
				return;
			}

			let components = [decoder, tracker, scrubber, preloader];
			components.forEach((component:EventEmitter) => {
				component.on('error', this.log.bind(this));
			});

			async.parallel([
				(cb) => {
					scrubber.once("ready", () => cb());
				},
				(cb) => {
					decoder.once("end", () => cb());
				}
			], () => {
				scrubber.play();
				if (this.pause || (typeof this.pause === "undefined" && this.startFromTurn)) {
					scrubber.pause();
				}
			});

			message
				.pipe(decoder) // xml -> mutators
				.pipe(tracker) // mutators -> latest gamestate
				.pipe(scrubber) // gamestate -> gamestate emit on scrub past
				.pipe(sink); // gamestate

			if (this.opts.cardArtDirectory) {
				decoder.pipe(preloader);
			}
		});
		decoder.once("build", (build?:number) => {
			if (this.queryCardMetadata) {
				let queryTime = Date.now();
				this.queryCardMetadata(build || null, (cards:CardData[]) => {
					this.ref.setCards(cards);
					this.track("metadata", {duration: (Date.now() - queryTime) / 1000}, {
						cards: cards.length,
						build: build
					});
				});
			}
		}).on("error", this.log.bind(this))
		.once("error", () => this.track("decoder_error", {count: 1}));

		this.opts.sink = sink;
		this.opts.scrubber = scrubber;
		this.opts.cardOracle = decoder;
		this.opts.mulliganOracle = decoder;

		this.render();

		this.track("starting_from_turn", {fromTurn: this.startFromTurn ? "t" : "f", turn: this.startFromTurn | null});
	}

	protected render():void {
		this.opts.startupTime = +Date.now();
		this.ref = ReactDOM.render(
			React.createElement(GameWidget, this.opts),
			typeof this.target === 'string' ? document.getElementById(this.target as string) : this.target
		);
	}
}

module.exports = {
	renderApplication: (target:string) => {
		ReactDOM.render(
			React.createElement(Application),
			document.getElementById(target)
		);
	},

	renderHSReplay: (target:string, url:string, opts?:GameWidgetProps) => {
		new Launcher(target).setOptions(opts).fromUrl(url);
	},

	launcher: (target:string | HTMLElement) => {
		return new Launcher(target);
	},

	release: ():string => {
		return JOUST_RELEASE;
	}
}
