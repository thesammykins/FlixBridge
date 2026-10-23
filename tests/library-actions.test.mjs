import assert from "node:assert/strict";
import { test } from "node:test";
import { InputSchema } from "../dist/index.js";

test("season cleanup requires explicit bounded season identities", () => {
	assert.equal(InputSchema.safeParse({target:"season",ids:[1],seasonNumbers:[-1]}).success, false);
	assert.equal(InputSchema.safeParse({target:"season",ids:[1],seasonNumbers:[1.5]}).success, false);
	assert.equal(InputSchema.safeParse({target:"season",ids:[1],seasonNumbers:[]}).success, false);
});

test("a complete flag without every selected viewer cannot authorize watched-season cleanup", async () => {
	const {prepareLibraryAction}=await import("../dist/library/actions.js");
	const item={service:"sonarr",id:1,mediaKind:"series",title:"Fixture",providerIds:{tvdb:"100"},path:"/media/fixture",sizeBytes:100,status:"ended",monitored:true,tags:[],ratings:[],apiFamily:3,complete:true,seasons:[{seasonNumber:1,monitored:true}],episodes:[{id:11,seasonNumber:1,episodeNumber:1,title:"One",monitored:true,fileId:21}],files:[{id:21,path:"/media/fixture/one.mkv",sizeBytes:100,episodeIds:[11]}]};
	await assert.rejects(prepareLibraryAction({service:"sonarr",target:"season",ids:[1],seasonNumbers:[1],deleteFiles:true,users:[{server:"plex",userId:"1"}]},{loadLibrarySnapshot:async()=>({items:[item],complete:true,errors:[],observedAt:"2026-01-01T00:00:00Z"}),getWatchEvidence:async()=>({complete:true,activePlayback:false,favourite:false,viewers:[],blockers:[]})}),e=>/viewer|user|evidence/i.test(e.message));
});

test("monitoring and deletion planners reject cross-season shared files", async () => {
	let planner;
	try { planner = (await import("../dist/library/actions.js")).planLibraryAction; } catch { /* feature absent */ }
	assert.equal(typeof planner, "function", "the season planner must exist");
	const item = {
		service:"sonarr",id:1,mediaKind:"series",title:"Fixture",providerIds:{tvdb:"100"},path:"/media/fixture",sizeBytes:100,
		status:"ended",monitored:true,tags:[],ratings:[],apiFamily:3,complete:true,
		seasons:[{seasonNumber:1,monitored:true},{seasonNumber:2,monitored:true}],
		episodes:[{id:11,seasonNumber:1,episodeNumber:1,title:"One",monitored:true,fileId:21},{id:12,seasonNumber:2,episodeNumber:1,title:"Two",monitored:true,fileId:21}],
		files:[{id:21,path:"/media/fixture/shared.mkv",sizeBytes:100,episodeIds:[11,12]}],
	};
	assert.throws(() => planner(item,{target:"season",ids:[1],seasonNumbers:[1],deleteFiles:true}), (error) => /outside|shared|scope/i.test(error.message));
});
