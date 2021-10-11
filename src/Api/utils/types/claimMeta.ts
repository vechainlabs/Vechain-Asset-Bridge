import { TokenInfo } from "../../../common/utils/types/tokenInfo";

export type ClaimMeta = {
    merkleRoot:string,
    from:TokenInfo,
    to:TokenInfo,
    sendingTxs:Array<string>,
    receivingTx:string,
    totalAmount:bigint,
    status:0|1|2    //0:InProcess 1:Watting for Claim 2: Claimed
}