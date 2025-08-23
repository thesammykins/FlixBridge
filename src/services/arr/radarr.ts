import type { ServiceImplementation } from "../base.js";
import { BaseArrService } from "../shared.js";

export class RadarrService
	extends BaseArrService
	implements ServiceImplementation
{
	readonly id = "radarr" as const;
	readonly mediaKind = "movie" as const;
	readonly endpoints = {
		lookup: "/movie/lookup",
		add: "/movie",
		wanted: "/movie/wanted",
	};
}
