import {withDB} from '../server/db.js';
import {fail,handleError,json} from '../server/http.js';
import {requireNewsCron,runNewsPipeline} from '../server/news-pipeline.js';
export function createNewsCronHandler(useDB=withDB,fetcher=fetch){return async(req,res)=>{try{if(req.method!=='GET')fail(405,'Method not allowed.');requireNewsCron(req);await useDB(async db=>json(res,200,await runNewsPipeline(db,fetcher)));}catch(error){handleError(res,error);}};}
export default createNewsCronHandler();
