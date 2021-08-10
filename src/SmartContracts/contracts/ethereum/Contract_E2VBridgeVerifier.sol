pragma solidity >=0.5.16 <0.6.0;
pragma experimental ABIEncoderV2;

import "./Library_ECVerify.sol";
import "./Library_Array.sol";

interface IV2EBridgeHead {
    function updateMerkleRoot(bytes32 _lastRoot, bytes32 _root) external;
    function lock(bytes32 _lastRoot) external;
    function locked() external returns (bool);
}

contract BridgeVerifierControl {
    address public governance;
    address public bridge;
    mapping(address => bool) public verifiers;
    uint8 public verifierCount;

    event VerifierChanged(address indexed _verifier,bool indexed _status);
    event GovernanceUpdate(address indexed _addr);
    event BridgeUpdate(address indexed _addr);

    function setGovernance(address _addr) external onlyGovernance {
        governance = _addr;
        emit GovernanceUpdate(_addr);
    }

    function setBridge(address _addr) external onlyGovernance {
        bridge = _addr;
        emit BridgeUpdate(_addr);
    }

    function addVerifier(address _verifier) external onlyGovernance {
        if(!verifiers[_verifier]){
            verifiers[_verifier] = true;
            verifierCount++;
        }
        emit VerifierChanged(_verifier,true);
    }

    function removeVerifier(address _verifier) external onlyGovernance {
        require(verifiers[_verifier] == true,"verifier not in map");
        verifiers[_verifier] = false;
        verifierCount--;
        emit VerifierChanged(_verifier,false);
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, "permission denied");
        _;
    }
}

contract E2VBridgeVerifier is BridgeVerifierControl{

    event UpdateBridgeMerkleRoot(bytes32 indexed _value);
    event LockBridge(bytes32 indexed _value);
    event ExecOpertion(bytes32 indexed _hash);

    mapping(bytes32 => bool) public merkleRootProposals;
    mapping(bytes32 => bool) public lockBridgeProposals;

    constructor() public
    {
        governance = msg.sender;
    }

    function updateBridgeMerkleRoot(
        bytes32 _lastRoot,
        bytes32 _root,
        bytes[] calldata _sigs,
        uint _blockRef,
        uint _expirnum
    ) external {
        require(expiration(_blockRef,_expirnum),"the transaction already expired");

        require(
            merkleRootProposals[_root] == false,
            "the opertion had executed"
        );

        IV2EBridgeHead bri = IV2EBridgeHead(bridge);
        require(bri.locked() == true, "the bridge hadn't locked");

        uint8 limit = quorum(verifierCount);
        require(_sigs.length + 1 >= limit, "Insufficient number of signatures");

        address[] memory signers = new address[](_sigs.length);
        for (uint8 i = 0; i < _sigs.length; i++) {
            address signer = ECVerify.ecrecovery(_root, _sigs[i]);
            require(verifiers[signer], "signer isn't a verifier");
            require(ArrayLib.addressExist(signers,signer) == false,"signer had approved");
            signers[i] = signer;
            if (i + 1 >= limit) {
                bri.updateMerkleRoot(_lastRoot, _root);
                merkleRootProposals[_root] = true;
                emit ExecOpertion(_root);
                emit UpdateBridgeMerkleRoot(_root);
                break;
            }
        }
    }

    function lockBridge(
        bytes32 _lastRoot, 
        bytes[] calldata _sigs,
        uint _blockRef,
        uint _expirnum
        ) 
        external {
        require(expiration(_blockRef,_expirnum),"the transaction already expired");
        
        require(
            lockBridgeProposals[_lastRoot] == false,
            "the opertion had executed"
        );

        IV2EBridgeHead bri = IV2EBridgeHead(bridge);
        require(bri.locked() == false, "the bridge had locked");

        uint8 limit = quorum(verifierCount);
        require(_sigs.length >= limit, "Insufficient number of signatures");

        address[] memory signers = new address[](_sigs.length);
        for (uint8 i = 0; i < _sigs.length; i++) {
            address signer = ECVerify.ecrecovery(_lastRoot, _sigs[i]);
            require(verifiers[signer], "signer isn't a verifier");
            require(ArrayLib.addressExist(signers,signer) == false,"signer had approved");
            signers[i] = signer;
            if (i + 1 >= limit) {
                bri.lock(_lastRoot);
                lockBridgeProposals[_lastRoot] == true;
                emit ExecOpertion(_lastRoot);
                emit LockBridge(_lastRoot);
                break;
            }
        }
    }

    function quorum(uint8 total) internal pure returns (uint8) {
        return uint8(((uint256(total) + 1) * 2) / 3);
    }

    function expiration(uint blockRef,uint expirnum) internal view returns(bool) {
        return block.number - blockRef <= expirnum;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, "permission denied");
        _;
    }
}