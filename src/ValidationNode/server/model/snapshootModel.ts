import { getConnection, getRepository } from "typeorm";
import { ActionData, ActionResult } from "../../utils/components/actionResult";
import { BridgeSnapshoot } from "../../utils/types/bridgeSnapshoot";
import { SnapshootEntity } from "./entities/snapshoot.entity";

export class SnapshootModel {

    constructor(env:any){
        this.env = env;
        this.config = env.config;
    }

    public async getLastSnapshoot():Promise<ActionData<BridgeSnapshoot>>{
        let result = new ActionData<BridgeSnapshoot>();
        result.data = {
            parentMerkleRoot:"0x0000000000000000000000000000000000000000000000000000000000000000",
            merkleRoot:"0x0000000000000000000000000000000000000000000000000000000000000000",
            chains:[
                {chainName:this.config.vechain.chainName,chainId:this.config.vechain.chainId,lockedBlockNum:this.config.vechain.startBlockNum,beginBlockNum:this.config.vechain.startBlockNum,endBlockNum:0},
                {chainName:this.config.ethereum.chainName,chainId:this.config.ethereum.chainId,lockedBlockNum:this.config.ethereum.startBlockNum,beginBlockNum:this.config.ethereum.startBlockNum,endBlockNum:0},
            ]
        }

        try {
            let data = await getRepository(SnapshootEntity)
                .createQueryBuilder("snapshoot")
                .where("snapshoot.invalid = :invalid",{invalid:true})
                .orderBy("snapshoot.blocknum","DESC")
                .getOne();
            if(data != undefined){
                result.data = {
                    parentMerkleRoot:data.parentMerkleRoot,
                    merkleRoot:data.merkleRoot,
                    chains:data.chains
                }
            }
        } catch (error) {
            result.error = error;
        }

        return result;
    }

    public async getSnapshootByRoot(root:string):Promise<ActionData<BridgeSnapshoot>>{
        let result = new ActionData<BridgeSnapshoot>();
        result.data = {
            parentMerkleRoot:"0x0000000000000000000000000000000000000000000000000000000000000000",
            merkleRoot:"0x0000000000000000000000000000000000000000000000000000000000000000",
            chains:[
                {
                    chainName:this.config.vechain.chainName,
                    chainId:this.config.vechain.chainId,
                    lockedBlockNum:this.config.vechain.startBlockNum,
                    beginBlockNum:this.config.vechain.startBlockNum,
                    endBlockNum:this.config.vechain.startBlockNum},
                {
                    chainName:this.config.ethereum.chainName,
                    chainId:this.config.ethereum.chainId,
                    lockedBlockNum:this.config.ethereum.startBlockNum,
                    beginBlockNum:this.config.ethereum.startBlockNum,
                    endBlockNum:this.config.ethereum.startBlockNum},
            ]
        }

        try {
            let data = await getRepository(SnapshootEntity)
                .findOne({where:{merkleRoot:root}});
                if(data != undefined){
                    result.data = {
                        parentMerkleRoot:data.parentMerkleRoot,
                        merkleRoot:data.merkleRoot,
                        chains:data.chains
                    }
                }
        } catch (error) {
            result.error = error;
        }

        return result;
    }

    public async deleteSnapshoot(root:string):Promise<ActionResult>{
        let result = new ActionResult();

        try {
            await getConnection()
            .createQueryBuilder()
            .delete()
            .from(SnapshootEntity)
            .where("merkleRoot = :merkleRoot", { merkleRoot: root })
            .execute();
        } catch (error) {
            result.error = error;
        }

        return result;
    }

    public async save(sn:BridgeSnapshoot):Promise<ActionResult>{
        let result = new ActionResult();

        try {
            let entity:SnapshootEntity = {
                merkleRoot:sn.merkleRoot,
                parentMerkleRoot:sn.parentMerkleRoot,
                blocknum:sn.chains.filter(chain => {return chain.chainName == this.config.vechain.chainName && chain.chainId == this.config.vechain.chainId;})[0]!.endBlockNum,
                chains:sn.chains,
                invalid:true
            }

            await getRepository(SnapshootEntity)
                .save(entity);

        } catch (error) {
            result.error = error;
        }

        return result;
    }

    private env:any;
    private config:any;
}