import Web3 from "web3";
import path from 'path';
import fs from 'fs';
import { SimpleWallet } from "@vechain/connex-driver";
import { Contract } from "web3-eth-contract";
import * as Devkit from 'thor-devkit';
import assert from 'assert';
import { compileContract } from "myvetools/dist/utils";
import { tokenid, TokenInfo } from "../../common/utils/types/tokenInfo";
import { BridgeTx } from "../../common/utils/types/bridgeTx";
import { BridgeSnapshoot, ZeroRoot } from "../../common/utils/types/bridgeSnapshoot";
import BridgeStorage from "../../common/bridgeStorage";
import { keccak256 } from "thor-devkit";
import "mocha";

export class E2VBridgeVerifierTestCase{
    public web3!:Web3;
    public wallet = new SimpleWallet();
    public configPath = path.join(__dirname,'../test.config.json');
    public contractdir = path.join(__dirname,"../../common/contracts/");
    public config:any = {};

    public wEthContract!:Contract;
    public wVetContract!:Contract;
    public bridgeContract!:Contract;
    public bridgeVerifierContract!:Contract;
    public tokenInfo:Array<TokenInfo> = new Array();

    public gasPrice!:string;

    public async init(){
        if(fs.existsSync(this.configPath)) {
            this.config = require(this.configPath);
            this.web3 = new Web3(new Web3.providers.HttpProvider(this.config.ethereum.nodeHost));
            let masterNode = Devkit.HDNode.fromMnemonic((this.config.mnemonic as string).split(' '));
            for (let index = 0; index < 10; index++) {
                let account = masterNode.derive(index);
                this.wallet.import(account.privateKey!.toString('hex'));
                this.web3.eth.accounts.wallet.add(account.privateKey!.toString('hex'));
            }

            try {

                const wEthFilePath = path.join(this.contractdir, "/ethereum/Contract_wEth.sol");
                const wEthAbi = JSON.parse(compileContract(wEthFilePath,"WETH9","abi"));
                this.wEthContract = new this.web3.eth.Contract(wEthAbi,this.config.ethereum.contracts.wEth.length == 42 ? this.config.ethereum.contracts.wEth : undefined);

                const wVetFilePath = path.join(this.contractdir, "/common/Contract_BridgeWrappedToken.sol");
                const wVetAbi = JSON.parse(compileContract(wVetFilePath,"BridgeWrappedToken","abi",[this.contractdir]));
                this.wVetContract = new this.web3.eth.Contract(wVetAbi,this.config.ethereum.contracts.wVet.length == 42 ? this.config.ethereum.contracts.wVet : undefined);

                const bridgeFilePath = path.join(this.contractdir, "/common/Contract_BridgeHead.sol");
                const bridgeAbi = JSON.parse(compileContract(bridgeFilePath,"BridgeHead","abi",[this.contractdir]));
                this.bridgeContract = new this.web3.eth.Contract(bridgeAbi,this.config.ethereum.contracts.e2vBridge.length == 42 ? this.config.ethereum.contracts.e2vBridge : undefined);

                const verifierFilePath = path.join(this.contractdir, "/ethereum/Contract_E2VBridgeVerifier.sol");
                const verifierAbi = JSON.parse(compileContract(verifierFilePath,"E2VBridgeVerifier","abi",[this.contractdir]));
                this.bridgeVerifierContract = new this.web3.eth.Contract(verifierAbi,this.config.ethereum.contracts.e2vBridgeVerifier.length == 42 ? this.config.ethereum.contracts.e2vBridgeVerifier : undefined);

                this.gasPrice = await this.web3.eth.getGasPrice();
            } catch (error) {
                assert.fail(`init faild`);
            }
        }else {
            assert.fail(`can't load ${this.configPath}`);
        }
    }

    public async deploy():Promise<string>{
        if(this.config.ethereum.contracts.e2vBridgeVerifier.length == 42){
            this.bridgeVerifierContract.options.address = this.config.ethereum.contracts.e2vBridgeVerifier;
        } else {
            try {
                const verifierFilePath = path.join(this.contractdir, "/ethereum/Contract_E2VBridgeVerifier.sol");
                const bytecode = compileContract(verifierFilePath,"E2VBridgeVerifier","bytecode",[this.contractdir]);
                const deployMethod = this.bridgeVerifierContract.deploy({data:bytecode});
                const gas = await deployMethod.estimateGas({
                    from:this.wallet.list[0].address
                });
                this.bridgeVerifierContract = await deployMethod.send({
                    from:this.wallet.list[0].address,
                    gas:gas,
                    gasPrice:this.gasPrice
                });

                const setGovMethod = this.bridgeVerifierContract.methods.setGovernance(this.wallet.list[1].address);
                const gas2 = await setGovMethod.estimateGas({
                    from:this.wallet.list[0].address
                });
                
                await setGovMethod.send({
                    from:this.wallet.list[0].address,
                    gas:gas2,
                    gasPrice:this.gasPrice
                });

                this.config.ethereum.contracts.e2vBridgeVerifier = this.bridgeVerifierContract.options.address;
                fs.writeFileSync(this.configPath,JSON.stringify(this.config));
            } catch (error) {
                assert.fail("deploy verifier faild");
            }
        }

        return this.config.ethereum.contracts.e2vBridgeVerifier;
    }

    public async initBridge(){
        if(this.config.ethereum.contracts.e2vBridge == ""){
            let bridgeAddr = await this.deployBridge();
            this.bridgeContract.options.address = bridgeAddr;
            this.config.ethereum.contracts.e2vBridge = bridgeAddr;
        }

        this.bridgeContract.options.address = this.config.ethereum.contracts.e2vBridge;
        const verifierAddr = await this.bridgeContract.methods.verifier().call();
        if(verifierAddr.toLocaleLowerCase() != this.config.ethereum.contracts.e2vBridgeVerifier.toLocaleLowerCase()){
            const setVerifierMethod = this.bridgeContract.methods.setVerifier(this.config.ethereum.contracts.e2vBridgeVerifier);
            const gas1 = await setVerifierMethod.estimateGas({
                from:this.wallet.list[1].address
            });
            await setVerifierMethod.send({
                from:this.wallet.list[1].address,
                gas:gas1,
                gasPrice:this.gasPrice
            });
        }

        const bridgeAddr = await this.bridgeVerifierContract.methods.bridge().call();
        if(bridgeAddr.toLocaleLowerCase() != this.config.ethereum.contracts.e2vBridge.toLocaleLowerCase()){
            const setBridgeMethod = this.bridgeVerifierContract.methods.setBridge(this.config.ethereum.contracts.e2vBridge);
            const gas2 = await setBridgeMethod.estimateGas({
                from:this.wallet.list[1].address
            });
            await setBridgeMethod.send({
                from:this.wallet.list[1].address,
                gas:gas2,
                gasPrice:this.gasPrice
            });
        }
    }

    public async initWETHToken() {
        let wEthAddr = "";
        if(this.config.ethereum.contracts.wEth.length == 42){
            const call = await this.bridgeContract.methods.tokens(this.config.ethereum.contracts.wEth).call();
            const type = Number(call[0]);
            if(type == 1){
                wEthAddr = this.config.ethereum.contracts.wEth;
            } else {
                wEthAddr = await this.deployWETH();
            }
        } else {
            wEthAddr = this.config.ethereum.contracts.wEth;
            await this.setUpdateWETH(wEthAddr);
        }
        this.wEthContract.options.address = wEthAddr;
    }

    public async initWVETToken(){
        let wVetAddr = "";
        if(this.config.ethereum.contracts.wVet.length == 42){
            const call = await this.bridgeContract.methods.tokens(this.config.ethereum.contracts.wVet).call();
            const type = Number(call[0]);
            if(type == 2){
                wVetAddr = this.config.ethereum.contracts.wVet;
            } else {
                wVetAddr = await this.deployWVET(this.config.ethereum.contracts.e2vBridge);
            }
        } else {
            wVetAddr = this.config.ethereum.contracts.wVet;
            await this.setUpdateWVET(wVetAddr);
        }
        this.wVetContract.options.address = wVetAddr;
    }

    public async addVerifiers(){
        try {
            const gas = await this.bridgeVerifierContract.methods.addVerifier(this.wallet.list[5].address).estimateGas({
                from:this.wallet.list[1].address
            });

            await this.bridgeVerifierContract.methods.addVerifier(this.wallet.list[5].address).send({
                from:this.wallet.list[1].address,
                gas:gas,
                gasPrice: this.gasPrice
            });

            await this.bridgeVerifierContract.methods.addVerifier(this.wallet.list[6].address).send({
                from:this.wallet.list[1].address,
                gas:gas,
                gasPrice: this.gasPrice
            });

            await this.bridgeVerifierContract.methods.addVerifier(this.wallet.list[7].address).send({
                from:this.wallet.list[1].address,
                gas:gas,
                gasPrice: this.gasPrice
            });

            const status1 = await this.bridgeVerifierContract.methods.verifiers(this.wallet.list[5].address).call();
            const status2 = await this.bridgeVerifierContract.methods.verifiers(this.wallet.list[6].address).call();
            const status3 = await this.bridgeVerifierContract.methods.verifiers(this.wallet.list[7].address).call();

            if(!status1 && !status2 && !status3){
                assert.fail("check status faild");
            }

        } catch (error) {
            assert.fail("addVerifier faild");
        }
    }

    public async removeVerifier(){

        try {
            const gas1 = await this.bridgeVerifierContract.methods.addVerifier(this.wallet.list[8].address).estimateGas({
                from:this.wallet.list[1].address
            });

            await this.bridgeVerifierContract.methods.addVerifier(this.wallet.list[8].address).send({
                from:this.wallet.list[1].address,
                gas:gas1,
                gasPrice: this.gasPrice
            });

            const gas2 = await this.bridgeVerifierContract.methods.removeVerifier(this.wallet.list[8].address).estimateGas({
                from:this.wallet.list[1].address
            });

            await this.bridgeVerifierContract.methods.removeVerifier(this.wallet.list[8].address).send({
                from:this.wallet.list[1].address,
                gas:gas2,
                gasPrice: this.gasPrice
            });


            const status = await this.bridgeVerifierContract.methods.verifiers(this.wallet.list[8].address).call();
            assert.strictEqual(status,false);

        } catch (error) {
            assert.fail("removeVerifier faild");
        }
    }

    public async updateMerkleRoot(){
        this.initTokens();

        const swapTx1 = await this.mockSwapWETH();
        const swapTx2 = await this.mockSwapWVET();

        const lastMerkleroot = await this.bridgeContract.methods.merkleRoot().call();
        const sign1 = await this.wallet.list[5].sign(this.signEncodePacked("lockBridge",lastMerkleroot));
        const sign2 = await this.wallet.list[6].sign(this.signEncodePacked("lockBridge",lastMerkleroot));
        const sign3 = await this.wallet.list[7].sign(this.signEncodePacked("lockBridge",lastMerkleroot));

        const blockRef = await this.web3.eth.getBlockNumber();

        const lockMethod = this.bridgeVerifierContract.methods.lockBridge(lastMerkleroot,[sign1,sign2,sign3],blockRef,24);
        const gas = await lockMethod.estimateGas({
            from:this.wallet.list[0].address
        });
        
        await lockMethod.send({
            from:this.wallet.list[0].address,
            gas:gas,
            gasPrice:this.gasPrice
        });

        const locked = await this.bridgeContract.methods.locked().call();
        assert.strictEqual(locked,true,"bridge not locked");

        const rootHash = this.initStorage(this.config.vechain.startBlockNum,blockRef,[swapTx1,swapTx2]);

        const sign4 = await this.wallet.list[5].sign(this.signEncodePacked("updateBridgeMerkleRoot",rootHash));
        const sign5 = await this.wallet.list[6].sign(this.signEncodePacked("updateBridgeMerkleRoot",rootHash));
        const sign6 = await this.wallet.list[7].sign(this.signEncodePacked("updateBridgeMerkleRoot",rootHash));

        const updateMethod = this.bridgeVerifierContract.methods.updateBridgeMerkleRoot(lastMerkleroot,rootHash,[sign4,sign5,sign6],blockRef,24);
        const gas2 = await updateMethod.estimateGas({
            from:this.wallet.list[0].address
        });

        await updateMethod.send({
            from:this.wallet.list[0].address,
            gas:gas2,
            gasPrice:this.gasPrice
        });

        const newMerkleRoot = await this.bridgeContract.methods.merkleRoot().call();
        assert.strictEqual(newMerkleRoot,rootHash,"Merkle Root not updated");
    }

    private async deployBridge():Promise<string>{
        let startBlockNum = 0;
        let txhash = "";
        try {
            const bridgeFilePath = path.join(this.contractdir, "/common/Contract_BridgeHead.sol");
            const bytecode = compileContract(bridgeFilePath,"BridgeHead","bytecode",[this.contractdir]);

            const gas1 = await this.bridgeContract.deploy({data:bytecode,arguments:[this.config.ethereum.chainName.toString(),
                this.config.ethereum.chainId.toString()]}).estimateGas({
                from:this.wallet.list[0].address
            });
            
            this.bridgeContract = await this.bridgeContract.deploy({data:bytecode,arguments:[this.config.ethereum.chainName.toString(),
                this.config.ethereum.chainId.toString()]}).send({
                from:this.wallet.list[0].address,
                gas:gas1,
                gasPrice:this.gasPrice
            }).on("receipt",function(receipt){
                startBlockNum = receipt.blockNumber;
                txhash = receipt.transactionHash;
            });

            const gas2 = await this.bridgeContract.methods.setVerifier(this.wallet.list[1].address).estimateGas({
                from:this.wallet.list[0].address
            });

            await this.bridgeContract.methods.setVerifier(this.wallet.list[1].address).send({
                from:this.wallet.list[0].address,
                gas:gas2,
                gasPrice:this.gasPrice
            }).on("receipt",function(receipt:any){
                txhash = receipt.transactionHash;
            });

            const gas3 = await this.bridgeContract.methods.setGovernance(this.wallet.list[1].address).estimateGas({
                from:this.wallet.list[0].address
            });
            await this.bridgeContract.methods.setGovernance(this.wallet.list[1].address).send({
                from:this.wallet.list[0].address,
                gas:gas3,
                gasPrice:this.gasPrice
            }).on("receipt",function(receipt:any){
                txhash = receipt.transactionHash;
            });

            this.config.ethereum.contracts.e2vBridge = this.bridgeContract.options.address;
            this.config.ethereum.startBlockNum = startBlockNum;
            fs.writeFileSync(this.configPath,JSON.stringify(this.config));
        } catch (error) {
            assert.fail(`deploy bridge faild: ${error}, txhash:${txhash}`);   
        }
        return this.config.ethereum.contracts.e2vBridge;
    }

    private async deployWETH():Promise<string>{
        const bridgeFilePath = path.join(this.contractdir, "/ethereum/Contract_wEth.sol");
        const bytecode = compileContract(bridgeFilePath,"WETH9","bytecode"); 
        let txhash = "";

        try {
            const gas = await this.wEthContract.deploy({data:bytecode}).estimateGas({
                from:this.wallet.list[0].address
            });
            this.wEthContract = await this.wEthContract.deploy({data:bytecode}).send({
                from:this.wallet.list[0].address,
                gas:gas,
                gasPrice:this.gasPrice
            }).on("receipt",function(receipt:any){
                txhash = receipt.transactionHash
            });

            this.config.ethereum.contracts.wEth = this.wEthContract.options.address;
    
            const gas2 = await this.bridgeContract.methods.setWrappedNativeCoin(this.config.ethereum.contracts.wEth,"0x0000000000000000000000000000000000000000",this.config.ethereum.startBlockNum,0).estimateGas({
                from:this.wallet.list[1].address
            });
            const s1 = await this.bridgeContract.methods.setWrappedNativeCoin(this.config.ethereum.contracts.wEth,"0x0000000000000000000000000000000000000000",this.config.ethereum.startBlockNum,0).send({
                from:this.wallet.list[1].address,
                gas:gas2,
                gasPrice:this.gasPrice
            }).on("receipt",function(receipt:any){
                txhash = receipt.transactionHash
            });

            const receipt1 = await this.web3.eth.getTransactionReceipt(s1.transactionHash);
            if(receipt1 == null || receipt1.status == false){
                assert.fail("setWrappedNativeCoin faild");
            }
            fs.writeFileSync(this.configPath,JSON.stringify(this.config));
        } catch (error) {
            assert.fail(`deploy WETH faild: ${error}, txhash:${txhash}`);
        }

        return this.config.ethereum.contracts.wEth;
    }

    private async setUpdateWETH(addr:string):Promise<any> {
        let txhash = "";
        try {
            const gas2 = await this.bridgeContract.methods.setWrappedNativeCoin(addr,"0x0000000000000000000000000000000000000000",this.config.ethereum.startBlockNum,0).estimateGas({
                from:this.wallet.list[1].address
            });
            const s1 = await this.bridgeContract.methods.setWrappedNativeCoin(addr,"0x0000000000000000000000000000000000000000",this.config.ethereum.startBlockNum,0).send({
                from:this.wallet.list[1].address,
                gas:gas2,
                gasPrice:this.gasPrice
            }).on("receipt",function(receipt:any){
                txhash = receipt.transactionHash
            });

            const receipt1 = await this.web3.eth.getTransactionReceipt(s1.transactionHash);
            if(receipt1 == null || receipt1.status == false){
                assert.fail("setWrappedNativeCoin faild");
            }
        } catch (error) {
            assert.fail(`set update WETH faild: ${error}, txhash:${txhash}`);
        }
    }

    private async deployWVET(addr:string):Promise<string>{
        const bridgeFilePath = path.join(this.contractdir, "/common/Contract_BridgeWrappedToken.sol");
        const bytecode = compileContract(bridgeFilePath,"BridgeWrappedToken","bytecode",[this.contractdir]);
        let txhash = "";

        try {
            const gas = await this.wVetContract.deploy({data:bytecode,arguments:["Wrapped VET","WVET",18,addr]}).estimateGas({
                from:this.wallet.list[0].address
            });
            this.wVetContract = await this.wVetContract.deploy({data:bytecode,arguments:["Wrapped VET","WVET",18,addr]}).send({
                from:this.wallet.list[0].address,
                gas:gas,
                gasPrice:this.gasPrice
            }).on("receipt",function(receipt:any){
                txhash = receipt.transactionHash
            });
            this.config.ethereum.contracts.wVet = this.wVetContract.options.address;
    
            const gas2 = await this.bridgeContract.methods.setToken(this.config.ethereum.contracts.wVet,2,"0x0000000000000000000000000000000000000000",this.config.ethereum.startBlockNum,0).estimateGas({
                from:this.wallet.list[1].address
            });
            const s1 = await this.bridgeContract.methods.setToken(this.config.ethereum.contracts.wVet,2,"0x0000000000000000000000000000000000000000",this.config.ethereum.startBlockNum,0).send({
                from:this.wallet.list[1].address,
                gas:gas2,
                gasPrice:this.gasPrice
            }).on("receipt",function(receipt:any){
                txhash = receipt.transactionHash
            });
            const receipt1 = await this.web3.eth.getTransactionReceipt(s1.transactionHash);
            if(receipt1 == null || receipt1.status == false){
                assert.fail("setToken faild");
            }
            fs.writeFileSync(this.configPath,JSON.stringify(this.config));
        } catch (error) {
            assert.fail(`deploy WVET faild: ${error}`);
        }

        return this.config.ethereum.contracts.wVet;
    }

    private async setUpdateWVET(addr:string):Promise<any>{
        let txhash = "";
        try {
            const gas2 = await this.bridgeContract.methods.setToken(addr,2,"0x0000000000000000000000000000000000000000",this.config.ethereum.startBlockNum,0).estimateGas({
                from:this.wallet.list[1].address
            });
            const s1 = await this.bridgeContract.methods.setToken(addr,2,"0x0000000000000000000000000000000000000000",this.config.ethereum.startBlockNum,0).send({
                from:this.wallet.list[1].address,
                gas:gas2,
                gasPrice:this.gasPrice
            }).on("receipt",function(receipt:any){
                txhash = receipt.transactionHash
            });
            const receipt1 = await this.web3.eth.getTransactionReceipt(s1.transactionHash);
            if(receipt1 == null || receipt1.status == false){
                assert.fail("setToken faild");
            }
        } catch (error) {
            assert.fail(`set update WVET faild: ${error}`);
        }
    }

    private initTokens() {
        this.tokenInfo = [
            {
                tokenid:"",
                chainName:this.config.vechain.chainName,
                chainId:this.config.vechain.chainId,
                name:"VVET",
                symbol:"VVET",
                decimals:18,
                address:this.config.vechain.contracts.vVet,
                nativeCoin:false,
                tokenType:"1",
                targetTokenId:"",
                begin:0,
                end:0,
                update:0,
                updateBlock:""
            },
            {
                tokenid:"",
                chainName:this.config.vechain.chainName,
                chainId:this.config.vechain.chainId,
                name:"VETH",
                symbol:"VETH",
                decimals:18,
                address:this.config.vechain.contracts.vEth,
                nativeCoin:false,
                tokenType:"2",
                targetTokenId:"",
                begin:0,
                end:0,
                update:0,
                updateBlock:""
            },
            {
                tokenid:"",
                chainName:this.config.ethereum.chainName,
                chainId:this.config.ethereum.chainId,
                name:"WVET",
                symbol:"WVET",
                decimals:18,
                address:this.config.ethereum.contracts.wVet,
                nativeCoin:false,
                tokenType:"2",
                targetTokenId:"",
                begin:0,
                end:0,
                update:0,
                updateBlock:""
            },
            {
                tokenid:"",
                chainName:this.config.ethereum.chainName,
                chainId:this.config.ethereum.chainId,
                name:"WVET",
                symbol:"WETH",
                decimals:18,
                address:this.config.ethereum.contracts.wEth,
                nativeCoin:false,
                tokenType:"1",
                targetTokenId:"",
                begin:0,
                end:0,
                update:0,
                updateBlock:""
            }
        ]

        for(let token of this.tokenInfo){
            token.tokenid = tokenid(token.chainName,token.chainId,token.address);
        }
        this.tokenInfo[0].targetTokenId = this.tokenInfo[2].tokenid;
        this.tokenInfo[2].targetTokenId = this.tokenInfo[0].tokenid;
        this.tokenInfo[1].targetTokenId = this.tokenInfo[3].tokenid;
        this.tokenInfo[3].targetTokenId = this.tokenInfo[1].tokenid;
    }

    private async mockSwapWETH():Promise<BridgeTx>{
        const amount = 100000000;

        const gas1 = await this.wEthContract.methods.deposit().estimateGas({
            from: this.wallet.list[3].address,
            value: amount
        });
        await this.wEthContract.methods.deposit().send({
            from: this.wallet.list[3].address,
            value: amount,
            gas:gas1,
            gasPrice:this.gasPrice
        });

        const gas2 = await this.wEthContract.methods.approve(this.config.ethereum.contracts.e2vBridge,amount).estimateGas({
            from: this.wallet.list[3].address
        });
        await this.wEthContract.methods.approve(this.config.ethereum.contracts.e2vBridge,amount).send({
            from: this.wallet.list[3].address,
            gas:gas2,
            gasPrice:this.gasPrice
        });

        const gas3 = await this.bridgeContract.methods.swap(this.config.ethereum.contracts.wEth,amount,this.wallet.list[4].address).estimateGas({
            from: this.wallet.list[3].address,
        });
        const s1 = await this.bridgeContract.methods.swap(this.config.ethereum.contracts.wEth,amount,this.wallet.list[4].address).send({
            from: this.wallet.list[3].address,
            gas:gas3,
            gasPrice:this.gasPrice
        });
        
        const receipt = await this.web3.eth.getTransactionReceipt(s1.transactionHash);
        if(receipt == null || receipt.status == false){
            assert.fail("swap WETH faild");
        }

        let result:BridgeTx = {
            chainName:this.config.ethereum.chainName,
            chainId:this.config.ethereum.chainId,
            blockNumber:receipt.blockNumber,
            blockId:receipt.blockHash,
            txid:receipt.transactionHash,
            clauseIndex:0,
            index:0,
            account:this.wallet.list[4].address,
            token:this.config.ethereum.wEth,
            amount:BigInt(amount),
            reward:BigInt(0),
            timestamp:(await this.web3.eth.getBlock(receipt.blockNumber)).timestamp as number,
            type:"swap"
        }

        
        return result;
    }

    private async mockSwapWVET():Promise<BridgeTx>{
        const amount = 200000000;
        let result:BridgeTx = {
            chainName:this.config.ethereum.chainName,
            chainId:this.config.ethereum.chainId,
            blockNumber:100000000,
            blockId:"0x009fa94909c7379638f5b8ce49c574d3ab95e5b89c810f7acc0734c63dcfe7c0",
            txid:"0x3273443c8c795077583b1601b1d219f56236c22deb88833df3970a138021083b",
            clauseIndex:0,
            index:0,
            account:this.wallet.list[4].address,
            token:this.config.ethereum.contracts.wVet,
            amount:BigInt(amount),
            reward:BigInt(0),
            timestamp:(new Date()).getTime(),
            type:"swap"
        }

        return result;
    }

    private initStorage(begin:number,end:number,swapTxs:BridgeTx[]):string{
        let result = "";
        const sn:BridgeSnapshoot = {
            parentMerkleRoot:"0x0000000000000000000000000000000000000000000000000000000000000000",
            merkleRoot:"0x0000000000000000000000000000000000000000000000000000000000000000",
            chains:[
                {
                    chainName:this.config.vechain.chainName,
                    chainId:this.config.vechain.chainId,
                    beginBlockNum:begin,
                    lockedBlockNum:begin,
                    endBlockNum:end},
                {
                    chainName:this.config.ethereum.chainName,
                    chainId:this.config.ethereum.chainId,
                    beginBlockNum:begin,
                    lockedBlockNum:begin,
                    endBlockNum:end}
            ]
        }

        let storage = new BridgeStorage(sn,this.tokenInfo);
        storage.updateLedgers(swapTxs);
        storage.buildTree();
        result = storage.getMerkleRoot();
        return result;
    }

    private signEncodePacked(opertion:string,hash:string):Buffer {
        let hashBuffer = hash != ZeroRoot() ? Buffer.from(hash.substr(2),'hex') : Buffer.alloc(32);
        let encode = Buffer.concat([
            Buffer.from(opertion),
            hashBuffer
        ]);
        return keccak256(encode);
    }
}

describe("E2V verifier test", ()=>{
    let testcase = new E2VBridgeVerifierTestCase();

    before(async() =>{
        await testcase.init();
    });

    it('deploy verifier contract', async() => {
        await testcase.deploy();
    });

    it('init bridge', async() =>{
        await testcase.initBridge();
    });

    it('init WETH token', async () => {
        await testcase.initWETHToken();
    });

    it('init WVET token', async () => {
        await testcase.initWVETToken();
    });

    // it('add verifiers', async() => {
    //    await testcase.addVerifiers();         
    // });

    // it('remove verifiers', async() => {
    //     await testcase.removeVerifier();
    // });

    // it('update Merkleroot', async() => {
    //     await testcase.updateMerkleRoot();
    // });
});