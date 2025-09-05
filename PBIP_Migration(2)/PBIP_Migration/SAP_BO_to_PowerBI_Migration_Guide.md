
# 🧭 SAP BusinessObjects to Power BI Migration Mapping Guide

## 1. Terminology Mapping

| SAP BO Term | Power BI Equivalent | Notes |
|-------------|----------------------|-------|
| Universe (.unx/.unv) | Dataset / Dataflow | Power BI lacks a direct semantic layer but uses datasets and dataflows for reusable models |
| Dimension Object | Dimension Column | Used for slicing and grouping data |
| Measure Object | Measure (DAX) | Aggregated numeric values |
| Detail Object | Related Column / Tooltip Field | Descriptive attributes tied to dimensions |
| @Prompt | Parameter / Slicer | Power BI uses slicers or report/page-level filters |
| Context | Relationship / DAX Context | Managed via relationships and filter propagation |
| Web Intelligence (WebI) | Power BI Reports | Power BI reports are more interactive and visual |
| Crystal Reports | Paginated Reports | Available via Power BI Report Builder |

## 2. Modeling Differences

| Aspect | SAP BO | Power BI |
|--------|--------|----------|
| Data Modeling | Centralized in Universe | Decentralized in Power BI Desktop |
| Joins | Defined in Universe | Defined via relationships in model view |
| Aggregations | Predefined in Universe | Dynamic via DAX |
| Metadata | Managed centrally | Managed per dataset or via external tools |
| Reusability | High (Universe shared across reports) | Moderate (shared datasets or dataflows) |

## 3. Report Development Workflow

| Step | SAP BO | Power BI |
|------|--------|----------|
| Data Source Connection | Universe or direct DB | Direct DB, APIs, files, or dataflows |
| Data Modeling | Universe Designer | Power BI Desktop |
| Report Authoring | WebI / Crystal Reports | Power BI Desktop |
| Publishing | BI Launchpad / CMC | Power BI Service |
| Scheduling | CMC / BO Scheduler | Power BI Service (with Premium) |
| Security | Row-level via Universe / CMC | Row-level via DAX filters and roles |

## 4. Migration Strategy

### ✅ Step-by-Step Plan

1. **Inventory Reports**: List all BO reports, usage, and dependencies.
2. **Analyze Universes**: Identify dimensions, measures, joins, and prompts.
3. **Rebuild Data Models**: Use Power BI Desktop to recreate models.
4. **Recreate Reports**: Design visuals and interactivity in Power BI.
5. **Validate Outputs**: Compare results between BO and Power BI.
6. **Deploy & Train**: Publish to Power BI Service and train users.
