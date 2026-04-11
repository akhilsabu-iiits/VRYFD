// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./VRYFToken.sol";

/**
 * @title VryfdAttendance
 * @notice Decentralized attendance verification with POAPs, milestone NFTs,
 *         time-stamped certificates, and $VRYF token rewards on Sepolia.
 * @dev Implements:
 *   Feature 1 - ENS-integrated attendance check-in  (+10 VRYF)
 *   Feature 2 - Soulbound POAP badge minting        (+25 VRYF)
 *   Feature 3 - Milestone-based reward NFTs          (+100/250/500 VRYF)
 *   Feature 4 - Time-stamped certificates with revocation
 */
contract VryfdAttendance is ERC1155, AccessControl, EIP712 {
    using ECDSA for bytes32;
    using Strings for uint256;

    // ──────────────────────────────────────────────
    // Roles
    // ──────────────────────────────────────────────
    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    // ──────────────────────────────────────────────
    // Structs
    // ──────────────────────────────────────────────
    struct Event {
        string name;
        string metadataURI;    // IPFS URI for badge image/metadata
        uint256 startTime;
        uint256 endTime;
        address organizer;
        bool active;
    }

    struct Certificate {
        uint256 eventId;
        address attendee;
        uint256 timestamp;
        string metadataURI;    // IPFS URI for certificate data
        bool isValid;
    }

    struct AttendanceRecord {
        uint256 eventId;
        uint256 timestamp;
        bool badgeClaimed;
    }

    // ──────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────
    uint256 public nextEventId;
    uint256 public nextCertificateId = 1;  // Certificates are 1-indexed; slot 0 is unused
    uint256 public nextBadgeTokenId = 1000;   // Badge token IDs start at 1000
    uint256 public nextMilestoneTokenId = 500_000;  // Milestone token IDs start at 500k to avoid collision with badge IDs (1000+)

    // Milestone thresholds
    uint256[] public milestoneThresholds;
    string[] public milestoneTierNames;
    mapping(uint256 => string) public milestoneTokenURIs;

    // Core mappings
    mapping(uint256 => Event) public events;
    mapping(uint256 => Certificate) public certificates;
    mapping(address => uint256) public totalAttendance;
    mapping(address => uint256) public highestMilestoneClaimed;

    // eventId => attendee => AttendanceRecord
    mapping(uint256 => mapping(address => AttendanceRecord)) public attendance;

    // eventId => badgeTokenId
    mapping(uint256 => uint256) public eventBadgeToken;

    // tokenId => tokenURI (for dynamic metadata)
    mapping(uint256 => string) private _tokenURIs;

    // Soulbound: track which tokens are non-transferable
    mapping(uint256 => bool) public isSoulbound;

    // EIP-712 typed hashes — shared nonce across all gasless operations
    bytes32 public constant CHECKIN_TYPEHASH =
        keccak256("CheckIn(address attendee,uint256 eventId,uint256 nonce)");
    bytes32 public constant CLAIM_BADGE_TYPEHASH =
        keccak256("ClaimBadge(address attendee,uint256 eventId,uint256 nonce)");
    bytes32 public constant CLAIM_MILESTONE_TYPEHASH =
        keccak256("ClaimMilestone(address attendee,uint256 nonce)");
    mapping(address => uint256) public nonces;

    // ── $VRYF Token ──
    VRYFToken public vryfToken;

    // ──────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────
    event EventCreated(uint256 indexed eventId, string name, address organizer);
    event AttendanceConfirmed(uint256 indexed eventId, address indexed attendee, uint256 timestamp);
    event BadgeMinted(uint256 indexed eventId, address indexed attendee, uint256 tokenId);
    event MilestoneReached(address indexed attendee, uint256 milestone, uint256 tokenId, string tierName);
    event CertificateIssued(uint256 indexed certificateId, uint256 indexed eventId, address indexed attendee);
    event CertificateRevoked(uint256 indexed certificateId);

    // ──────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────
    constructor(
        string memory baseURI,
        address vryfTokenAddress
    ) ERC1155(baseURI) EIP712("VryfdAttendance", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORGANIZER_ROLE, msg.sender);
        _grantRole(RELAYER_ROLE, msg.sender);

        vryfToken = VRYFToken(vryfTokenAddress);

        // Default milestone thresholds
        milestoneThresholds.push(5);
        milestoneThresholds.push(10);
        milestoneThresholds.push(20);

        milestoneTierNames.push("Bronze Explorer");
        milestoneTierNames.push("Silver Pioneer");
        milestoneTierNames.push("Gold Legend");
    }

    // ──────────────────────────────────────────────
    // Feature 1: Event & Attendance Management
    // ──────────────────────────────────────────────

    /// @notice Create a new event (organizer only)
    function createEvent(
        string calldata name,
        string calldata metadataURI,
        uint256 startTime,
        uint256 endTime
    ) external onlyRole(ORGANIZER_ROLE) returns (uint256) {
        require(endTime > startTime, "Invalid time range");
        require(endTime > block.timestamp, "Event has already ended");

        uint256 eventId = nextEventId++;
        events[eventId] = Event({
            name: name,
            metadataURI: metadataURI,
            startTime: startTime,
            endTime: endTime,
            organizer: msg.sender,
            active: true
        });

        // Create a unique badge token ID for this event
        uint256 badgeTokenId = nextBadgeTokenId++;
        eventBadgeToken[eventId] = badgeTokenId;
        _tokenURIs[badgeTokenId] = metadataURI;
        isSoulbound[badgeTokenId] = true; // POAPs are soulbound

        emit EventCreated(eventId, name, msg.sender);
        return eventId;
    }

    /// @notice Check in to an event directly (organizer pays gas)
    /// @dev Restricted to ORGANIZER_ROLE — use confirmAttendanceGasless for user-initiated flow.
    ///      Open access would let anyone bypass the join-code verification on the backend.
    function checkIn(uint256 eventId) external onlyRole(ORGANIZER_ROLE) {
        _recordAttendance(eventId, msg.sender);
    }

    /// @notice Organizer marks an attendee as present (organizer pays gas, no user signature needed)
    /// @dev Used for roll-call / join-code flows where the organizer confirms physical presence
    function checkInFor(address attendee, uint256 eventId) external onlyRole(ORGANIZER_ROLE) {
        _recordAttendance(eventId, attendee);
    }

    /// @notice Gasless check-in via relayer (Feature 1 Add-On: Off-chain Signatures)
    function confirmAttendanceGasless(
        address attendee,
        uint256 eventId,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRole(RELAYER_ROLE) {
        bytes32 structHash = keccak256(
            abi.encode(CHECKIN_TYPEHASH, attendee, eventId, nonces[attendee]++)
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, v, r, s);
        require(signer == attendee, "Invalid signature");

        _recordAttendance(eventId, attendee);
    }

    /// @notice Batch gasless check-ins (relayer submits multiple at once)
    function batchConfirmAttendance(
        address[] calldata attendees,
        uint256[] calldata eventIds,
        uint8[] calldata vs,
        bytes32[] calldata rs,
        bytes32[] calldata ss
    ) external onlyRole(RELAYER_ROLE) {
        require(
            attendees.length == eventIds.length &&
            attendees.length == vs.length &&
            attendees.length == rs.length &&
            attendees.length == ss.length,
            "Array length mismatch"
        );
        require(attendees.length <= 100, "Batch too large");

        // Deduplicate: reject batches that contain the same (attendee, eventId) pair twice.
        // Without this, a crafted batch could pass two valid signatures for the same attendee
        // by pre-computing sig(nonce N) and sig(nonce N+1) before the nonce is incremented.
        for (uint256 i = 0; i < attendees.length; i++) {
            for (uint256 j = i + 1; j < attendees.length; j++) {
                require(
                    attendees[i] != attendees[j] || eventIds[i] != eventIds[j],
                    "Duplicate attendee+event in batch"
                );
            }
        }

        for (uint256 i = 0; i < attendees.length; i++) {
            bytes32 structHash = keccak256(
                abi.encode(CHECKIN_TYPEHASH, attendees[i], eventIds[i], nonces[attendees[i]]++)
            );
            bytes32 hash = _hashTypedDataV4(structHash);
            address signer = ECDSA.recover(hash, vs[i], rs[i], ss[i]);
            require(signer == attendees[i], "Invalid signature");

            _recordAttendance(eventIds[i], attendees[i]);
        }
    }

    // ──────────────────────────────────────────────
    // Feature 2: POAP Badge Minting
    // ──────────────────────────────────────────────

    /// @notice Claim your soulbound POAP badge for an event you attended
    function claimBadge(uint256 eventId) external {
        AttendanceRecord storage record = attendance[eventId][msg.sender];
        require(record.timestamp > 0, "Not attended");
        require(!record.badgeClaimed, "Badge already claimed");

        record.badgeClaimed = true;
        uint256 tokenId = eventBadgeToken[eventId];

        _mint(msg.sender, tokenId, 1, "");

        // Reward: +25 VRYF for claiming a badge
        try vryfToken.mintBadgeReward(msg.sender) {} catch {}

        emit BadgeMinted(eventId, msg.sender, tokenId);
    }

    // ──────────────────────────────────────────────
    // Feature 3: Milestone NFT Rewards
    // ──────────────────────────────────────────────

    /// @notice Claim a milestone reward NFT if eligible
    /// @dev CEI pattern: all state writes happen before any external calls (_mint, vryfToken)
    ///      so a malicious ERC-1155 receiver cannot re-enter and double-claim milestones.
    function milestoneReward() external {
        uint256 attended = totalAttendance[msg.sender];
        uint256 highest = highestMilestoneClaimed[msg.sender];

        // ── Checks & Effects ────────────────────────────────────────────────
        // Collect all eligible milestones and write all state before any external call.
        uint256[] memory tokenIds    = new uint256[](milestoneThresholds.length);
        uint256[] memory thresholds  = new uint256[](milestoneThresholds.length);
        string[]  memory tierNames   = new string[](milestoneThresholds.length);
        uint256 count = 0;
        uint256 newHighest = highest;

        for (uint256 i = 0; i < milestoneThresholds.length; i++) {
            if (attended >= milestoneThresholds[i] && highest < milestoneThresholds[i]) {
                uint256 tokenId = nextMilestoneTokenId++;
                _tokenURIs[tokenId] = milestoneTokenURIs[milestoneThresholds[i]];
                isSoulbound[tokenId] = true;
                tokenIds[count]   = tokenId;
                thresholds[count] = milestoneThresholds[i];
                tierNames[count]  = milestoneTierNames[i];
                newHighest = milestoneThresholds[i];
                count++;
            }
        }

        // Write highest milestone to storage before any external call
        if (newHighest > highest) {
            highestMilestoneClaimed[msg.sender] = newHighest;
        }

        // ── Interactions ─────────────────────────────────────────────────────
        // External calls only after all state is committed — reentrancy-safe.
        for (uint256 i = 0; i < count; i++) {
            _mint(msg.sender, tokenIds[i], 1, "");
            try vryfToken.mintMilestoneReward(msg.sender, thresholds[i]) {} catch {}
            emit MilestoneReached(msg.sender, thresholds[i], tokenIds[i], tierNames[i]);
        }
    }

    /// @notice Gasless badge claim — attendee signs, relayer submits and pays gas
    function claimBadgeGasless(
        address attendee,
        uint256 eventId,
        uint8 v, bytes32 r, bytes32 s
    ) external onlyRole(RELAYER_ROLE) {
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_BADGE_TYPEHASH, attendee, eventId, nonces[attendee]++)
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        require(ECDSA.recover(hash, v, r, s) == attendee, "Invalid signature");

        AttendanceRecord storage record = attendance[eventId][attendee];
        require(record.timestamp > 0, "Not attended");
        require(!record.badgeClaimed, "Badge already claimed");

        record.badgeClaimed = true;
        uint256 tokenId = eventBadgeToken[eventId];
        _mint(attendee, tokenId, 1, "");
        try vryfToken.mintBadgeReward(attendee) {} catch {}
        emit BadgeMinted(eventId, attendee, tokenId);
    }

    /// @notice Gasless milestone reward — attendee signs, relayer submits and pays gas
    function milestoneRewardGasless(
        address attendee,
        uint8 v, bytes32 r, bytes32 s
    ) external onlyRole(RELAYER_ROLE) {
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_MILESTONE_TYPEHASH, attendee, nonces[attendee]++)
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        require(ECDSA.recover(hash, v, r, s) == attendee, "Invalid signature");

        uint256 attended = totalAttendance[attendee];
        uint256 highest = highestMilestoneClaimed[attendee];

        uint256[] memory tokenIds   = new uint256[](milestoneThresholds.length);
        uint256[] memory thresholds = new uint256[](milestoneThresholds.length);
        string[]  memory tierNames  = new string[](milestoneThresholds.length);
        uint256 count = 0;
        uint256 newHighest = highest;

        for (uint256 i = 0; i < milestoneThresholds.length; i++) {
            if (attended >= milestoneThresholds[i] && highest < milestoneThresholds[i]) {
                uint256 tokenId = nextMilestoneTokenId++;
                _tokenURIs[tokenId] = milestoneTokenURIs[milestoneThresholds[i]];
                isSoulbound[tokenId] = true;
                tokenIds[count]   = tokenId;
                thresholds[count] = milestoneThresholds[i];
                tierNames[count]  = milestoneTierNames[i];
                newHighest = milestoneThresholds[i];
                count++;
            }
        }

        if (newHighest > highest) highestMilestoneClaimed[attendee] = newHighest;

        for (uint256 i = 0; i < count; i++) {
            _mint(attendee, tokenIds[i], 1, "");
            try vryfToken.mintMilestoneReward(attendee, thresholds[i]) {} catch {}
            emit MilestoneReached(attendee, thresholds[i], tokenIds[i], tierNames[i]);
        }
    }

    /// @notice Update the stored URI for any token (organizer only — for correcting wrong URIs)
    /// @dev Emits the ERC1155 URI event so indexers and wallets refresh their cache.
    function setTokenURI(uint256 tokenId, string calldata newURI) external onlyRole(ORGANIZER_ROLE) {
        _tokenURIs[tokenId] = newURI;
        emit URI(newURI, tokenId);
    }

    /// @notice Set the metadata URI for a milestone tier (organizer only)
    function setMilestoneURI(
        uint256 threshold,
        string calldata metadataURI
    ) external onlyRole(ORGANIZER_ROLE) {
        milestoneTokenURIs[threshold] = metadataURI;
    }

    // ──────────────────────────────────────────────
    // Feature 4: Time-Stamped Certificates
    // ──────────────────────────────────────────────

    /// @notice Issue a time-stamped certificate for an attendee
    function issueCertificate(
        uint256 eventId,
        address attendee,
        string calldata metadataURI
    ) external onlyRole(ORGANIZER_ROLE) returns (uint256) {
        require(attendance[eventId][attendee].timestamp > 0, "Attendee not recorded");

        uint256 certId = nextCertificateId++;
        certificates[certId] = Certificate({
            eventId: eventId,
            attendee: attendee,
            timestamp: block.timestamp,
            metadataURI: metadataURI,
            isValid: true
        });

        emit CertificateIssued(certId, eventId, attendee);
        return certId;
    }

    /// @notice Revoke a certificate (organizer only)
    function revokeCertificate(uint256 certificateId) external onlyRole(ORGANIZER_ROLE) {
        require(certificates[certificateId].timestamp > 0, "Certificate not found");
        certificates[certificateId].isValid = false;
        emit CertificateRevoked(certificateId);
    }

    /// @notice Verify a certificate's validity (public view)
    function verifyCertificate(uint256 certificateId) external view returns (
        uint256 eventId,
        address attendee,
        uint256 timestamp,
        string memory metadataURI,
        bool isValid
    ) {
        Certificate storage cert = certificates[certificateId];
        require(cert.timestamp > 0, "Certificate not found");
        return (cert.eventId, cert.attendee, cert.timestamp, cert.metadataURI, cert.isValid);
    }

    // ──────────────────────────────────────────────
    // Soulbound Transfer Restriction (Feature 2 Add-On)
    // ──────────────────────────────────────────────

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        for (uint256 i = 0; i < ids.length; i++) {
            // Allow minting (from == address(0)) and burning (to == address(0))
            if (from != address(0) && to != address(0) && isSoulbound[ids[i]]) {
                revert("Soulbound: non-transferable");
            }
        }
        super._update(from, to, ids, values);
    }

    // ──────────────────────────────────────────────
    // View Functions
    // ──────────────────────────────────────────────

    function uri(uint256 tokenId) public view override returns (string memory) {
        string memory tokenURI = _tokenURIs[tokenId];
        if (bytes(tokenURI).length > 0) {
            return tokenURI;
        }
        return super.uri(tokenId);
    }

    function getAttendanceRecord(
        uint256 eventId,
        address attendee
    ) external view returns (uint256 timestamp, bool badgeClaimed) {
        AttendanceRecord storage record = attendance[eventId][attendee];
        return (record.timestamp, record.badgeClaimed);
    }

    function getMilestoneThresholds() external view returns (uint256[] memory) {
        return milestoneThresholds;
    }

    function getMilestoneTierNames() external view returns (string[] memory) {
        return milestoneTierNames;
    }

    /// @notice Get user's current tier name based on attendance
    function getUserTier(address user) external view returns (string memory) {
        uint256 attended = totalAttendance[user];
        string memory tier = "Newcomer";
        for (uint256 i = 0; i < milestoneThresholds.length; i++) {
            if (attended >= milestoneThresholds[i]) {
                tier = milestoneTierNames[i];
            }
        }
        return tier;
    }

    // ──────────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────────

    function _recordAttendance(uint256 eventId, address attendee) internal {
        Event storage evt = events[eventId];
        require(evt.active, "Event not active");
        require(block.timestamp >= evt.startTime, "Event not started");
        require(block.timestamp <= evt.endTime, "Event ended");
        require(attendance[eventId][attendee].timestamp == 0, "Already checked in");

        attendance[eventId][attendee] = AttendanceRecord({
            eventId: eventId,
            timestamp: block.timestamp,
            badgeClaimed: false
        });

        totalAttendance[attendee]++;

        // Reward: +10 VRYF for checking in
        try vryfToken.mintCheckInReward(attendee) {} catch {}

        emit AttendanceConfirmed(eventId, attendee, block.timestamp);
    }

    // ──────────────────────────────────────────────
    // Required Overrides
    // ──────────────────────────────────────────────

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
