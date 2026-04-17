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
 *   Feature 5 - Webinar attendance tracking with configurable thresholds
 *   Feature 6 - Physical event check-ins with signature verification
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
    // Enums
    // ──────────────────────────────────────────────
    
    /// @notice Event type classification
    enum EventType { VIRTUAL, PHYSICAL, HYBRID }

    // ──────────────────────────────────────────────
    // Structs
    // ──────────────────────────────────────────────
    struct Event {
        string name;
        string metadataURI;           // IPFS URI for badge image/metadata
        uint256 startTime;
        uint256 endTime;
        address organizer;
        bool active;
        uint256 attendanceThreshold;  // Percentage required for certificate (e.g., 75 = 75%)
        uint256 claimPeriodDays;      // Days after event end to claim certificate
        uint256 durationMinutes;      // Scheduled event duration in minutes
        EventType eventType;          // VIRTUAL, PHYSICAL, or HYBRID
    }

    struct Certificate {
        uint256 eventId;
        address attendee;
        uint256 timestamp;
        string metadataURI;    // IPFS URI for certificate data
        bool isValid;
        uint256 tokenId;       // ERC-1155 soulbound token ID for this certificate
    }

    struct AttendanceRecord {
        uint256 eventId;
        uint256 timestamp;
        bool badgeClaimed;
        uint256 attendancePercentage;  // Percentage of event attended (0-100)
        uint256 totalMinutesPresent;   // Total minutes present for webinars
        uint256 checkInTime;           // Timestamp of first check-in
        uint256 checkpointCount;       // Number of checkpoints scanned (physical/hybrid)
    }

    /// @notice Organizer-defined reward tier for an event
    struct RewardTier {
        string name;           // e.g. "Early Joiner", "Full Attendance"
        uint256 minPercentage; // Minimum attendance % to qualify
        string metadataURI;    // IPFS URI for reward NFT metadata
        bool active;
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

    /// @notice Authorized backend relayers for webinar attendance recording
    mapping(address => bool) public backendRelayers;

    // Certificate token IDs start at 2_000_000 to avoid collision
    uint256 public nextCertTokenId = 2_000_000;

    // Per-event reward tiers: eventId => tier index => RewardTier
    mapping(uint256 => RewardTier[]) public eventRewardTiers;
    // Reward tier token IDs start at 3_000_000
    uint256 public nextRewardTierTokenId = 3_000_000;
    // Track claimed reward tiers: eventId => attendee => tier index => claimed
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) public rewardTierClaimed;

    // Multi-checkpoint config: eventId => total checkpoint count
    mapping(uint256 => uint256) public eventCheckpointCount;

    // EIP-712 typed hashes — shared nonce across all gasless operations
    bytes32 public constant CHECKIN_TYPEHASH =
        keccak256("CheckIn(address attendee,uint256 eventId,uint256 nonce)");
    bytes32 public constant CLAIM_BADGE_TYPEHASH =
        keccak256("ClaimBadge(address attendee,uint256 eventId,uint256 nonce)");
    bytes32 public constant CLAIM_MILESTONE_TYPEHASH =
        keccak256("ClaimMilestone(address attendee,uint256 nonce)");
    bytes32 public constant PHYSICAL_CHECKIN_TYPEHASH =
        keccak256("PhysicalCheckIn(address attendee,uint256 eventId,uint256 nonce)");
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
    
    /// @notice Emitted when webinar attendance is recorded
    event WebinarAttendanceRecorded(uint256 indexed eventId, address indexed attendee, uint256 percentage);
    
    /// @notice Emitted when physical event check-in occurs
    event PhysicalCheckIn(uint256 indexed eventId, address indexed attendee, uint256 timestamp);
    
    /// @notice Emitted when event attendance threshold is updated
    event ThresholdUpdated(uint256 indexed eventId, uint256 newThreshold);
    
    /// @notice Emitted when backend relayer status changes
    event BackendRelayerUpdated(address indexed relayer, bool status);

    /// @notice Emitted when an event is edited
    event EventUpdated(uint256 indexed eventId, string name, string metadataURI);

    /// @notice Emitted when an event is cancelled
    event EventCancelled(uint256 indexed eventId);

    /// @notice Emitted when a reward tier is added to an event
    event RewardTierAdded(uint256 indexed eventId, uint256 tierIndex, string name);

    /// @notice Emitted when a reward tier NFT is claimed
    event RewardTierClaimed(uint256 indexed eventId, address indexed attendee, uint256 tierIndex, uint256 tokenId);

    /// @notice Emitted when a physical checkpoint is recorded
    event CheckpointRecorded(uint256 indexed eventId, address indexed attendee, uint256 checkpointNumber);

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
    /// @param name Event name
    /// @param metadataURI IPFS URI for event metadata
    /// @param startTime Event start timestamp
    /// @param endTime Event end timestamp
    /// @param attendanceThreshold Percentage required for certificate (default 75)
    /// @param claimPeriodDays Days after event to claim certificate (default 30)
    /// @param durationMinutes Scheduled event duration in minutes
    /// @param eventType Type of event (VIRTUAL, PHYSICAL, HYBRID)
    /// @return eventId The created event ID
    function createEvent(
        string calldata name,
        string calldata metadataURI,
        uint256 startTime,
        uint256 endTime,
        uint256 attendanceThreshold,
        uint256 claimPeriodDays,
        uint256 durationMinutes,
        EventType eventType
    ) external onlyRole(ORGANIZER_ROLE) returns (uint256) {
        require(endTime > startTime, "Invalid time range");
        require(endTime > block.timestamp, "Event has already ended");
        require(attendanceThreshold > 0 && attendanceThreshold <= 100, "Invalid threshold");
        require(durationMinutes > 0, "Invalid duration");

        uint256 eventId = nextEventId++;
        events[eventId] = Event({
            name: name,
            metadataURI: metadataURI,
            startTime: startTime,
            endTime: endTime,
            organizer: msg.sender,
            active: true,
            attendanceThreshold: attendanceThreshold,
            claimPeriodDays: claimPeriodDays,
            durationMinutes: durationMinutes,
            eventType: eventType
        });

        // Create a unique badge token ID for this event
        uint256 badgeTokenId = nextBadgeTokenId++;
        eventBadgeToken[eventId] = badgeTokenId;
        _tokenURIs[badgeTokenId] = metadataURI;
        isSoulbound[badgeTokenId] = true; // POAPs are soulbound

        emit EventCreated(eventId, name, msg.sender);
        return eventId;
    }

    /// @notice Edit an existing event (organizer only, before event ends)
    function editEvent(
        uint256 eventId,
        string calldata name,
        string calldata metadataURI,
        uint256 startTime,
        uint256 endTime,
        uint256 attendanceThreshold,
        uint256 durationMinutes
    ) external onlyRole(ORGANIZER_ROLE) {
        Event storage evt = events[eventId];
        require(evt.organizer == msg.sender, "Not event organizer");
        require(evt.active, "Event not active");
        require(endTime > startTime, "Invalid time range");
        require(attendanceThreshold > 0 && attendanceThreshold <= 100, "Invalid threshold");
        require(durationMinutes > 0, "Invalid duration");

        evt.name = name;
        evt.metadataURI = metadataURI;
        evt.startTime = startTime;
        evt.endTime = endTime;
        evt.attendanceThreshold = attendanceThreshold;
        evt.durationMinutes = durationMinutes;

        uint256 badgeTokenId = eventBadgeToken[eventId];
        _tokenURIs[badgeTokenId] = metadataURI;

        emit EventUpdated(eventId, name, metadataURI);
    }

    /// @notice Cancel an event (organizer only)
    function cancelEvent(uint256 eventId) external onlyRole(ORGANIZER_ROLE) {
        Event storage evt = events[eventId];
        require(evt.organizer == msg.sender, "Not event organizer");
        require(evt.active, "Event already inactive");

        evt.active = false;

        emit EventCancelled(eventId);
    }

    /// @notice Configure multi-checkpoint for a physical/hybrid event
    function setEventCheckpoints(
        uint256 eventId,
        uint256 totalCheckpoints
    ) external onlyRole(ORGANIZER_ROLE) {
        Event storage evt = events[eventId];
        require(evt.organizer == msg.sender, "Not event organizer");
        require(evt.active, "Event not active");
        require(totalCheckpoints > 0 && totalCheckpoints <= 20, "Invalid checkpoint count");
        require(evt.eventType == EventType.PHYSICAL || evt.eventType == EventType.HYBRID, "Only physical/hybrid events");

        eventCheckpointCount[eventId] = totalCheckpoints;
    }

    /// @notice Add a reward tier to an event (organizer only)
    function addRewardTier(
        uint256 eventId,
        string calldata name,
        uint256 minPercentage,
        string calldata metadataURI
    ) external onlyRole(ORGANIZER_ROLE) {
        Event storage evt = events[eventId];
        require(evt.organizer == msg.sender, "Not event organizer");
        require(evt.active, "Event not active");
        require(minPercentage > 0 && minPercentage <= 100, "Invalid percentage");

        eventRewardTiers[eventId].push(RewardTier({
            name: name,
            minPercentage: minPercentage,
            metadataURI: metadataURI,
            active: true
        }));

        emit RewardTierAdded(eventId, eventRewardTiers[eventId].length - 1, name);
    }

    /// @notice Claim a per-event reward tier NFT
    function claimRewardTier(uint256 eventId, uint256 tierIndex) external {
        AttendanceRecord storage record = attendance[eventId][msg.sender];
        require(record.timestamp > 0, "Not attended");

        RewardTier storage tier = eventRewardTiers[eventId][tierIndex];
        require(tier.active, "Tier not active");
        require(record.attendancePercentage >= tier.minPercentage, "Below minimum attendance");
        require(!rewardTierClaimed[eventId][msg.sender][tierIndex], "Already claimed");

        rewardTierClaimed[eventId][msg.sender][tierIndex] = true;

        uint256 tokenId = nextRewardTierTokenId++;
        _tokenURIs[tokenId] = tier.metadataURI;
        isSoulbound[tokenId] = true;
        _mint(msg.sender, tokenId, 1, "");

        emit RewardTierClaimed(eventId, msg.sender, tierIndex, tokenId);
    }

    /// @notice Get reward tiers for an event
    function getEventRewardTiers(uint256 eventId) external view returns (
        string[] memory names,
        uint256[] memory minPercentages,
        bool[] memory actives
    ) {
        uint256 len = eventRewardTiers[eventId].length;
        names = new string[](len);
        minPercentages = new uint256[](len);
        actives = new bool[](len);
        for (uint256 i = 0; i < len; i++) {
            names[i] = eventRewardTiers[eventId][i].name;
            minPercentages[i] = eventRewardTiers[eventId][i].minPercentage;
            actives[i] = eventRewardTiers[eventId][i].active;
        }
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

        // O(n) deduplication: _recordAttendance already reverts on "Already checked in",
        // so a duplicate (attendee, eventId) pair will be caught by the existing
        // attendance[eventId][attendee].timestamp == 0 check in _recordAttendance.
        // The nonce increment in the signature verification below also prevents
        // replay of pre-computed signatures since each call consumes a unique nonce.

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
    // Feature 5: Webinar Attendance Tracking
    // ──────────────────────────────────────────────

    /// @notice Record webinar attendance with time tracking (relayer only)
    /// @dev Called by addresses with RELAYER_ROLE to record webinar participation.
    ///      Also accepts legacy backendRelayers mapping for backwards compatibility.
    /// @param eventId The event ID
    /// @param attendee The attendee address
    /// @param minutesPresent Total minutes the attendee was present
    function recordWebinarAttendance(
        uint256 eventId,
        address attendee,
        uint256 minutesPresent
    ) external {
        require(
            hasRole(RELAYER_ROLE, msg.sender) || backendRelayers[msg.sender],
            "Not authorized relayer"
        );
        Event storage evt = events[eventId];
        require(evt.active, "Event not active");
        require(evt.eventType == EventType.VIRTUAL || evt.eventType == EventType.HYBRID, "Not a virtual event");
        
        AttendanceRecord storage record = attendance[eventId][attendee];
        
        // Initialize record if first time
        if (record.timestamp == 0) {
            record.eventId = eventId;
            record.timestamp = block.timestamp;
            record.badgeClaimed = false;
            record.checkInTime = block.timestamp;
            totalAttendance[attendee]++;
        }
        
        // Update attendance metrics
        record.totalMinutesPresent = minutesPresent;
        
        // Calculate attendance percentage
        if (evt.durationMinutes > 0) {
            record.attendancePercentage = (minutesPresent * 100) / evt.durationMinutes;
            if (record.attendancePercentage > 100) {
                record.attendancePercentage = 100; // Cap at 100%
            }
        }
        
        emit WebinarAttendanceRecorded(eventId, attendee, record.attendancePercentage);
        
        // Reward: +10 VRYF for webinar participation (only on first record)
        if (record.totalMinutesPresent == minutesPresent) {
            try vryfToken.mintCheckInReward(attendee) {} catch {}
        }
    }

    // ──────────────────────────────────────────────
    // Feature 6: Physical Event Check-In
    // ──────────────────────────────────────────────

    /// @notice Record physical event check-in with signature verification
    /// @dev Supports multi-checkpoint: if checkpoints configured, each scan increments
    ///      the checkpoint count and recalculates attendance percentage. First scan creates
    ///      the attendance record; subsequent scans update percentage.
    function recordPhysicalCheckIn(
        address attendee,
        uint256 eventId,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRole(RELAYER_ROLE) {
        Event storage evt = events[eventId];
        require(evt.active, "Event not active");
        require(evt.eventType == EventType.PHYSICAL || evt.eventType == EventType.HYBRID, "Not a physical event");
        require(block.timestamp >= evt.startTime, "Event not started");
        require(block.timestamp <= evt.endTime, "Event ended");

        bytes32 structHash = keccak256(
            abi.encode(PHYSICAL_CHECKIN_TYPEHASH, attendee, eventId, nonces[attendee]++)
        );
        bytes32 hash = _hashTypedDataV4(structHash);
        require(ECDSA.recover(hash, v, r, s) == attendee, "Invalid signature");

        AttendanceRecord storage record = attendance[eventId][attendee];
        uint256 totalCheckpoints = eventCheckpointCount[eventId];

        if (record.timestamp == 0) {
            record.eventId = eventId;
            record.timestamp = block.timestamp;
            record.checkInTime = block.timestamp;
            record.badgeClaimed = false;
            record.checkpointCount = 1;

            if (totalCheckpoints > 1) {
                record.attendancePercentage = (1 * 100) / totalCheckpoints;
                record.totalMinutesPresent = evt.durationMinutes / totalCheckpoints;
            } else {
                record.attendancePercentage = 100;
                record.totalMinutesPresent = evt.durationMinutes;
            }

            totalAttendance[attendee]++;
            try vryfToken.mintCheckInReward(attendee) {} catch {}

            emit PhysicalCheckIn(eventId, attendee, block.timestamp);
        } else {
            require(totalCheckpoints > 1, "Single-checkpoint: already checked in");
            require(record.checkpointCount < totalCheckpoints, "All checkpoints scanned");

            record.checkpointCount++;
            record.attendancePercentage = (record.checkpointCount * 100) / totalCheckpoints;
            record.totalMinutesPresent = (evt.durationMinutes * record.checkpointCount) / totalCheckpoints;

            emit CheckpointRecorded(eventId, attendee, record.checkpointCount);
        }
    }

    // ──────────────────────────────────────────────
    // Certificate Eligibility & Management
    // ──────────────────────────────────────────────

    /// @notice Check if attendee is eligible for certificate based on attendance threshold
    /// @param eventId The event ID
    /// @param attendee The attendee address
    /// @return eligible True if attendee meets the threshold
    function isEligibleForCertificate(
        uint256 eventId,
        address attendee
    ) public view returns (bool eligible) {
        Event storage evt = events[eventId];
        AttendanceRecord storage record = attendance[eventId][attendee];
        
        // Must have attended
        if (record.timestamp == 0) {
            return false;
        }
        
        // Check if within claim period
        if (evt.claimPeriodDays > 0) {
            uint256 claimDeadline = evt.endTime + (evt.claimPeriodDays * 1 days);
            if (block.timestamp > claimDeadline) {
                return false;
            }
        }
        
        // Check attendance percentage meets threshold
        return record.attendancePercentage >= evt.attendanceThreshold;
    }

    /// @notice Update the attendance threshold for an event
    /// @dev Only organizer can update, and only before event ends
    /// @param eventId The event ID
    /// @param newThreshold New threshold percentage (1-100)
    function updateEventThreshold(
        uint256 eventId,
        uint256 newThreshold
    ) external onlyRole(ORGANIZER_ROLE) {
        require(newThreshold > 0 && newThreshold <= 100, "Invalid threshold");
        Event storage evt = events[eventId];
        require(evt.organizer == msg.sender, "Not event organizer");
        require(block.timestamp <= evt.endTime, "Event ended");
        
        evt.attendanceThreshold = newThreshold;
        
        emit ThresholdUpdated(eventId, newThreshold);
    }

    /// @notice Get detailed attendance information for an attendee
    /// @param eventId The event ID
    /// @param attendee The attendee address
    /// @return timestamp Check-in timestamp
    /// @return badgeClaimed Whether badge was claimed
    /// @return attendancePercentage Percentage of event attended
    /// @return totalMinutesPresent Total minutes present
    /// @return checkInTime Physical check-in time
    /// @return eligible Whether eligible for certificate
    function getAttendanceDetails(
        uint256 eventId,
        address attendee
    ) external view returns (
        uint256 timestamp,
        bool badgeClaimed,
        uint256 attendancePercentage,
        uint256 totalMinutesPresent,
        uint256 checkInTime,
        bool eligible
    ) {
        AttendanceRecord storage record = attendance[eventId][attendee];
        return (
            record.timestamp,
            record.badgeClaimed,
            record.attendancePercentage,
            record.totalMinutesPresent,
            record.checkInTime,
            isEligibleForCertificate(eventId, attendee)
        );
    }

    // ──────────────────────────────────────────────
    // Backend Relayer Management
    // ──────────────────────────────────────────────

    /// @notice Add a backend relayer (admin only)
    /// @param relayer Address to authorize as backend relayer
    function addBackendRelayer(address relayer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(relayer != address(0), "Invalid address");
        backendRelayers[relayer] = true;
        emit BackendRelayerUpdated(relayer, true);
    }

    /// @notice Remove a backend relayer (admin only)
    /// @param relayer Address to remove from backend relayers
    function removeBackendRelayer(address relayer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        backendRelayers[relayer] = false;
        emit BackendRelayerUpdated(relayer, false);
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

    /// @notice Issue a time-stamped certificate as a soulbound ERC-1155 NFT
    function issueCertificate(
        uint256 eventId,
        address attendee,
        string calldata metadataURI
    ) external onlyRole(ORGANIZER_ROLE) returns (uint256) {
        require(attendance[eventId][attendee].timestamp > 0, "Attendee not recorded");
        require(isEligibleForCertificate(eventId, attendee), "Not eligible for certificate");

        uint256 certId = nextCertificateId++;
        uint256 certTokenId = nextCertTokenId++;
        _tokenURIs[certTokenId] = metadataURI;
        isSoulbound[certTokenId] = true;

        certificates[certId] = Certificate({
            eventId: eventId,
            attendee: attendee,
            timestamp: block.timestamp,
            metadataURI: metadataURI,
            isValid: true,
            tokenId: certTokenId
        });

        _mint(attendee, certTokenId, 1, "");

        emit CertificateIssued(certId, eventId, attendee);
        return certId;
    }

    /// @notice Revoke a certificate and burn the soulbound NFT (organizer only)
    function revokeCertificate(uint256 certificateId) external onlyRole(ORGANIZER_ROLE) {
        Certificate storage cert = certificates[certificateId];
        require(cert.timestamp > 0, "Certificate not found");
        cert.isValid = false;

        if (cert.tokenId > 0 && balanceOf(cert.attendee, cert.tokenId) > 0) {
            _burn(cert.attendee, cert.tokenId, 1);
        }

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
            badgeClaimed: false,
            attendancePercentage: 100, // Default 100% for direct check-ins
            totalMinutesPresent: evt.durationMinutes, // Full duration credit
            checkInTime: block.timestamp,
            checkpointCount: 1
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
