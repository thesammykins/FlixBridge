import type { ServiceImplementation } from "../base.js";
import { BaseArrService } from "../shared.js";

export class SonarrService
	extends BaseArrService
	implements ServiceImplementation
{
	readonly id = "sonarr" as const;
	readonly mediaKind = "series" as const;
	readonly endpoints = {
		lookup: "/series/lookup",
		add: "/series",
		wanted: "/wanted/missing",
	};
}
