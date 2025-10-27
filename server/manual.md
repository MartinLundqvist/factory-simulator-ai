# Factory Production Line Operations Manual

## 1. System Overview

The factory is a discrete event simulation (DES) of a three-stage production line that processes items from raw materials to finished products.

### 1.1 Production Stages

1. **Stage 1: Cutting Station**
   - Resource: Cutter
   - Function: Cuts raw materials into parts
   - Output: Parts placed in Buffer 1→2 (buf12)

2. **Stage 2: Cell Processing**
   - Resources: Robot + Heater (both required simultaneously)
   - Function: Processes parts using robotic handling and heat treatment
   - Input: Parts from Buffer 1→2 (buf12)
   - Output: Processed parts to Buffer 2→3 (buf23)

3. **Stage 3: Packaging Station**
   - Resource: Packer
   - Function: Packages finished parts for shipment
   - Input: Parts from Buffer 2→3 (buf23)
   - Output: Completed items (depart system)

### 1.2 Resources

| Resource | Default Capacity | Purpose |
|----------|-----------------|---------|
| Cutter   | 1               | Cutting raw materials |
| Robot    | 1               | Material handling in cell |
| Heater   | 1               | Heat treatment in cell |
| Packer   | 1               | Final packaging |

### 1.3 Buffers (Storage Queues)

| Buffer | Default Capacity | Location |
|--------|-----------------|----------|
| buf12  | 5 items         | Between cutting and cell processing |
| buf23  | 5 items         | Between cell processing and packaging |

## 2. Operational Parameters

### 2.1 Arrival Pattern

- **Parameter**: `arrivalMean`
- **Default**: 1.8 minutes
- **Distribution**: Exponential (memoryless)
- **Description**: Average time between raw material arrivals

### 2.2 Processing Times

All processing times use **triangular distribution** for realistic variation:

| Stage | Parameter | Default | Var Low | Var High | Effective Range |
|-------|-----------|---------|---------|----------|-----------------|
| Cutting | `cutTime` | 1.2 min | 0.8× | 1.2× | 0.96 - 1.44 min |
| Cell Processing | `cellTime` | 2.5 min | 0.8× | 1.2× | 2.0 - 3.0 min |
| Packaging | `packTime` | 1.0 min | 0.8× | 1.3× | 0.8 - 1.3 min |

**Triangular Distribution**:
- Low bound = Var Low × Base Time
- Mode (most likely) = Base Time
- High bound = Var High × Base Time

### 2.3 Simulation Control

- **Simulation Duration**: `simHours` (default: 4 hours)
- **Step Delay**: `stepDelayMs` (default: 100ms between simulation steps)
- **Random Seed**: `randomSeed` (default: 42, for reproducibility)

## 3. Performance Metrics

### 3.1 Key Performance Indicators (KPIs)

1. **Throughput**: Items completed per hour
   - Target: Maximize while maintaining stability
   - Calculation: completed items ÷ simulation hours

2. **Average Cycle Time**: Time from item arrival to departure (minutes)
   - Target: Minimize
   - Calculation: Average of all individual cycle times

3. **Work-In-Progress (WIP)**: Average number of items in system
   - Target: Balance (low WIP = lean, but too low = starvation)
   - Calculation: Time-weighted average

4. **Resource Utilization**: Percentage of time resource is busy
   - Target: 70-85% (allows flexibility, prevents overload)
   - Formula: (time in use) ÷ (total time)

5. **Buffer Utilization**: Average fill level of buffers
   - Target: 30-70% (provides buffering without excess WIP)
   - Indicates balance between stages

### 3.2 Little's Law Verification

**Formula**: WIP = Throughput × Cycle Time

This fundamental relationship should hold for any stable system:
- If WIP = TH × CT, the simulation is consistent
- Deviations indicate measurement errors or instability

## 4. Optimization Strategies

### 4.1 Bottleneck Identification

**The bottleneck is the resource with the highest utilization.**

To identify bottlenecks:
1. Check resource utilization in state data
2. Look for resources at >85% utilization
3. Check for queues (items waiting for a resource)
4. Observe buffer levels:
   - Buffer before bottleneck: tends to fill up
   - Buffer after bottleneck: tends to be empty

### 4.2 Capacity Optimization

**Rule**: Throughput is limited by the slowest (bottleneck) stage.

**Strategies**:

1. **Increase Bottleneck Capacity**
   - Add more units of the bottleneck resource
   - Example: `robotCapacity: 2` if Robot is bottleneck
   - Benefit: Directly increases throughput

2. **Reduce Processing Time**
   - Lower the time parameter for the bottleneck stage
   - Example: Reduce `cellTime` if Cell Processing is bottleneck
   - Benefit: Increases effective capacity

3. **Balance the Line**
   - Adjust capacities so all stages have similar utilization (70-80%)
   - Prevents one stage from dominating
   - Benefit: Smooth flow, reduced WIP

### 4.3 Buffer Sizing

**Purpose**: Buffers decouple stages and absorb variability.

**Guidelines**:

- **Too Small**: Starvation (downstream waits for parts)
  - Symptom: Frequent zero items in buffer
  - Solution: Increase buffer capacity

- **Too Large**: Excess WIP, increased cycle time
  - Symptom: Buffer always near capacity
  - Solution: Decrease buffer capacity or fix bottleneck

- **Optimal**: 30-70% average utilization
  - Provides cushion against variability
  - Doesn't trap excessive WIP

**Typical Settings**:
- Fast processing, low variability: 3-5 items
- Slow processing, high variability: 7-10 items

### 4.4 Arrival Rate Tuning

**Balance**: Arrival rate should match system capacity.

- **Too Fast**: WIP builds up, buffers overflow, increased cycle time
  - Solution: Increase `arrivalMean` (slower arrivals)

- **Too Slow**: Resources idle, low throughput
  - Solution: Decrease `arrivalMean` (faster arrivals)

**Optimal**: Set so bottleneck resource is at ~80% utilization

### 4.5 Variability Reduction

**Principle**: Variability increases WIP and cycle time.

**Actions**:
1. Tighten triangular distribution bounds:
   - Reduce `VarHigh` and increase `VarLow`
   - Example: Change 0.8×-1.3× to 0.9×-1.1×

2. Process standardization:
   - Use consistent processing times
   - Reduce variance at bottleneck first

**Benefit**: Smoother flow, lower WIP, more predictable output

## 5. Reliability and Failures

### 5.1 Robot Failure Model

The Robot is subject to random failures:

- **MTBF (Mean Time Between Failures)**: `failMTBF`
  - Default: 90 minutes
  - Distribution: Exponential
  - Average time robot operates before failing

- **MTTR (Mean Time To Repair)**: `failMTTR`
  - Default: 6 minutes
  - Distribution: Exponential
  - Average time to repair robot

### 5.2 Failure Impact

When Robot fails:
1. Robot resource is seized for repair
2. Cell Processing stage stops
3. Items queue up in buf12 (cutting continues)
4. buf23 drains (packaging continues)
5. After repair, normal operation resumes

**Performance Impact**:
- Reduced throughput (downtime)
- Increased average cycle time
- Increased WIP (items wait during failure)
- Potential buffer overflow

### 5.3 Reliability Optimization

**Strategies**:

1. **Increase MTBF** (improve reliability)
   - Better maintenance, higher quality equipment
   - Example: Change `failMTBF: 90` to `failMTBF: 120`

2. **Decrease MTTR** (faster repairs)
   - Better spare parts availability, trained technicians
   - Example: Change `failMTTR: 6` to `failMTTR: 3`

3. **Add Redundancy**
   - Increase Robot capacity: `robotCapacity: 2`
   - System continues with one robot during repairs
   - **Most effective** but increases cost

4. **Buffer Sizing**
   - Increase buf12 to absorb WIP during downtime
   - Increase buf23 to keep packaging fed during failure

## 6. Normal Operating Ranges

### 6.1 Throughput Targets

Based on default parameters:

| Scenario | Expected Throughput | Notes |
|----------|---------------------|-------|
| Optimal conditions | 25-30 items/hour | No failures, balanced capacities |
| With robot failures | 20-25 items/hour | MTBF=90, MTTR=6 |
| Unbalanced line | 15-20 items/hour | Bottleneck severely constrained |

### 6.2 Utilization Targets

| Resource | Healthy Range | Warning Level | Critical Level |
|----------|---------------|---------------|----------------|
| All resources | 60-85% | 85-95% | >95% |

**Interpretation**:
- <60%: Underutilized, could process more
- 60-85%: Optimal, good balance
- 85-95%: High utilization, monitor for issues
- >95%: Bottleneck, will limit throughput

### 6.3 WIP Guidelines

| Metric | Healthy Range | Warning Level |
|--------|---------------|---------------|
| Average WIP | 5-15 items | >20 items |
| Buffer utilization | 30-70% | >80% |

## 7. Troubleshooting Guide

### 7.1 Problem: Low Throughput

**Symptoms**: Fewer items produced per hour than expected

**Possible Causes**:
1. Bottleneck resource at 100% utilization
   - Solution: Increase capacity or reduce processing time

2. Frequent robot failures
   - Solution: Improve MTBF, reduce MTTR, or add redundancy

3. Arrival rate too slow
   - Solution: Decrease `arrivalMean`

4. Processing times too long
   - Solution: Reduce `cutTime`, `cellTime`, or `packTime`

### 7.2 Problem: High WIP

**Symptoms**: Many items in buffers or queues

**Possible Causes**:
1. Arrival rate too fast for system capacity
   - Solution: Increase `arrivalMean` or increase capacity

2. Severe bottleneck
   - Solution: Add capacity to bottleneck resource

3. Buffers too large
   - Solution: Reduce `buf12Cap` or `buf23Cap`

### 7.3 Problem: High Cycle Time

**Symptoms**: Items take too long from arrival to completion

**Possible Causes**:
1. High WIP (items wait in queues)
   - Solution: Reduce WIP (see 7.2)

2. Bottleneck causing delays
   - Solution: Increase bottleneck capacity

3. Frequent failures
   - Solution: Improve reliability

**Note**: By Little's Law, high cycle time often accompanies high WIP.

### 7.4 Problem: Starvation

**Symptoms**: Resources idle, low buffer levels downstream

**Possible Causes**:
1. Arrival rate too slow
   - Solution: Decrease `arrivalMean`

2. Upstream bottleneck
   - Solution: Increase capacity of earlier stage

3. Buffer too small
   - Solution: Increase buffer capacity

### 7.5 Problem: Buffer Overflow

**Symptoms**: Buffer always at max capacity, items blocked

**Possible Causes**:
1. Downstream bottleneck
   - Solution: Increase capacity of later stage

2. Buffer too small for variability
   - Solution: Increase buffer capacity

3. Robot failures causing backlog
   - Solution: Improve reliability or add capacity

## 8. Optimization Workflow

**Recommended Process**:

1. **Baseline Measurement**
   - Run simulation with default parameters
   - Record throughput, cycle time, WIP, utilizations

2. **Identify Bottleneck**
   - Check resource utilizations
   - Look for highest utilization (>85%)
   - Observe buffer levels

3. **Experiment with Changes**
   - Increase bottleneck capacity by 1
   - Run simulation again
   - Compare metrics

4. **Iterate**
   - If throughput improved: consider further increases
   - If new bottleneck emerged: address it
   - Balance multiple resources

5. **Verify Stability**
   - Check Little's Law: WIP ≈ Throughput × CycleTime
   - Ensure no resources >95% utilization
   - Confirm buffer utilization in healthy range

6. **Cost-Benefit Analysis**
   - Capacity increases have cost
   - Balance throughput gains against investment
   - Prioritize changes with highest ROI

## 9. Advanced Topics

### 9.1 Theory of Constraints (TOC)

**Key Principle**: Focus improvement efforts on the bottleneck.

1. Identify the constraint (bottleneck)
2. Exploit the constraint (maximize its productivity)
3. Subordinate everything to the constraint
4. Elevate the constraint (add capacity)
5. Repeat (find new constraint)

### 9.2 Queueing Theory

The system behaves like an M/G/c queue system:
- **M**: Memoryless (exponential) arrivals
- **G**: General (triangular) service times
- **c**: Number of servers (resource capacity)

**Key Insight**: As utilization approaches 100%, queue length grows exponentially.

### 9.3 Kingman's Equation

Approximates waiting time in queue:

```
Wait Time ≈ (utilization / (1 - utilization)) × (variability factor) × average service time
```

**Implications**:
- Higher utilization → much longer waits
- Higher variability → longer waits
- Keep utilization <85% for reasonable wait times

### 9.4 Variance Amplification

**Phenomenon**: Variability increases moving upstream.

**In this system**:
- Robot failures cause variability
- Variability propagates to buffers
- buf12 sees more variability than buf23

**Mitigation**: Add capacity or buffers at points of high variability.

## 10. Quick Reference

### 10.1 Parameter Ranges

| Parameter | Min | Typical | Max | Units |
|-----------|-----|---------|-----|-------|
| arrivalMean | 0.5 | 1.8 | 5.0 | minutes |
| cutTime | 0.5 | 1.2 | 3.0 | minutes |
| cellTime | 1.0 | 2.5 | 5.0 | minutes |
| packTime | 0.5 | 1.0 | 2.0 | minutes |
| cutterCapacity | 1 | 1 | 3 | units |
| robotCapacity | 1 | 1 | 3 | units |
| heaterCapacity | 1 | 1 | 3 | units |
| packerCapacity | 1 | 1 | 3 | units |
| buf12Cap | 2 | 5 | 20 | items |
| buf23Cap | 2 | 5 | 20 | items |
| failMTBF | 30 | 90 | 300 | minutes |
| failMTTR | 1 | 6 | 20 | minutes |

### 10.2 Common Commands

- **Start simulation**: Use factory_control with action "start"
- **Stop simulation**: Use factory_control with action "stop"
- **Reset simulation**: Use factory_control with action "reset"
- **Get current state**: Use factory_control with action "getState"
- **View parameters**: Use factory_params with action "get"
- **Update parameters**: Use factory_params with action "update" and params object

### 10.3 Optimization Checklist

- [ ] Identify bottleneck (highest utilization)
- [ ] Check buffer levels (30-70% optimal)
- [ ] Verify no starvation (resources not idle)
- [ ] Balance line (all resources 70-85% utilized)
- [ ] Reduce variability if possible
- [ ] Size buffers for variability
- [ ] Improve reliability (MTBF/MTTR)
- [ ] Verify Little's Law
- [ ] Monitor throughput trend
- [ ] Document changes and results
