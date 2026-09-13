---
marp: true
theme: ecee2026
paginate: true
html: true
footer: '<img class="logo-ecee" src="./assets/ecee2026_logo.png" alt="ECEE2026 logo" /><img class="skyline" src="./assets/skyline_footer.png" alt="" /><img class="logo-rptu" src="./assets/rptu_logo.png" alt="RPTU logo" /><img class="logo-tuberlin" src="./assets/tuberlin_logo.png" alt="TU Berlin logo" /><span class="footer-caption">ML structural system classification<span class="footer-dash"> &mdash; </span><span class="footer-author">Ureña-Pliego et al.</span><br class="footer-break"><a href="https://miguelurenapliego.github.io/ECEE26/">miguelurenapliego.github.io/ECEE26</a></span>'
---

<!-- _class: title -->
<!-- _paginate: false -->
<!-- _header: '<img class="logos-top-left" src="./logos/all_logos_in_one_line_left.jpeg" alt="Funding and partner logos" /><img class="logo-riskcar" src="./logos/logo_riskcar.jpeg" alt="RISK CARIBERIA logo" />' -->

<!-- Optional faded background map. Delete these two lines to turn it off. -->
<!-- MAP:title_bg -->
<div class="map-slot map-slot--title_bg bg-map-frame"></div>

# Machine learning classification of structural systems using exclusively geospatial and remote sensing attributes: A case study in Santo Domingo, Dominican Republic

<div class="authors">

Miguel Ureña-Pliego<sup>1,*</sup>, Javier Rodríguez-Saiz<sup>1,2</sup>, Javier Sempere-Hernández<sup>3</sup>, Beatriz Moya-García<sup>4,5</sup>, Sebastián Rodríguez-Iturra<sup>5</sup>, Francisco Chinesta<sup>4,5</sup>, Beatriz González-Rodrigo<sup>6</sup>, Miguel Marchamalo-Sacristán<sup>1,7</sup>

</div>

<div class="affiliations">

<sup>1</sup> Departamento de Ingeniería y Morfología del Terreno, ETSICCP, Universidad Politécnica de Madrid, Spain
<sup>2</sup> Buin Ingenieros, S.L. Madrid, Spain
<sup>3</sup> Facultad de Ciencias, Universidad Nacional de Educación a Distancia, Spain
<sup>4</sup> CNRS@CREATE LTD., Singapore
<sup>5</sup> ENSAM Institute of Technology, Paris, France
<sup>6</sup> Departamento de Ingeniería y Gestión Forestal, ETSIMFYMN, Universidad Politécnica de Madrid, Spain
<sup>7</sup> Centro de I+D+i en Infraestructuras Inteligentes y Sostenibles (CIVILis), ETSICCP, Universidad Politécnica de Madrid, Spain
<br>* Corresponding author: Miguel Ureña-Pliego — <a href="mailto:miguel.urena@upm.es">miguel.urena@upm.es</a><br><a href="https://www.linkedin.com/in/miguel-urena-pliego/" class="contact-icon-link"><img src="./assets/icon_linkedin.png" class="contact-icon"> linkedin.com/in/miguel-urena-pliego</a> &nbsp;<a href="https://github.com/MiguelUrenaPliego" class="contact-icon-link"><img src="./assets/icon_github.png" class="contact-icon"> github.com/MiguelUrenaPliego</a>

</div>

---

<!-- _class: figure -->

# Background: GEM attributes

![Building attribute taxonomy](./figures/DNA.jpg)

<span class="slide-ref">Brzev et al., 2013</span>

---

<!-- _class: figure -->

# Background: GEM exposure models

<div class="gem-row">
<!-- MAP:gem_exposure -->
<div class="map-slot map-slot--gem_exposure gem-exposure-bg"></div>
<img src="./figures/buildings_simulation.jpg" class="gem-figure">
</div>

<span class="slide-ref">GEM Foundation, n.d.</span>

---

<!-- _class: figure -->

# Methodology: Proposed workflow

![Proposed geospatial-to-classification workflow](./figures/proposed_workflow.jpg)

<span class="slide-ref">Yepes-Estrada et al., 2023</span>

---



<!-- _class: map -->

# Results

<!-- MAP:intro -->
<div class="map-slot map-slot--intro"></div>

---

<!-- _class: map -->

<!-- MAP:intro_attributes -->
<div class="map-slot map-slot--intro_attributes"></div>

---

# Footprint geometry

<div class="geometry-row">

<div class="geometry-col-table">

<table class="geom-table">
<thead>
<tr>
<th>Metric</th>
<th>Mask2Former</th>
<th>SAM2</th>
<th>Microsoft</th>
</tr>
</thead>
<tbody>
<tr>
<td>AJ</td>
<td>0.580</td>
<td>0.630</td>
<td>0.099</td>
</tr>
<tr>
<td>SBD</td>
<td>0.560</td>
<td>0.737</td>
<td>0.124</td>
</tr>
<tr>
<td>PQ</td>
<td>0.446</td>
<td>0.530</td>
<td>0.002</td>
</tr>
<tr>
<td>mAP</td>
<td>0.224</td>
<td>0.277</td>
<td>0.0003</td>
</tr>
<tr>
<td>sAP</td>
<td>0.370</td>
<td>0.526</td>
<td>0.044</td>
</tr>
</tbody>
</table>

</div>

<div class="geometry-col-images">

<div class="geometry-grid">

<div class="geometry-thumb">
<img src="figures/sd_30cm_gt.jpg">
<div>Santo Domingo GT</div>
</div>

<div class="geometry-thumb">
<img src="figures/mask2former_sd_30cm.jpg">
<div>Mask2Former</div>
</div>

<div class="geometry-thumb">
<img src="figures/SAM2_sd.jpg">
<div>SAM2</div>
</div>

<div class="geometry-thumb">
<img src="figures/santo_domingo_microsoft.jpg">
<div>Microsoft</div>
</div>

</div>

</div>

</div>

<!-- Note: these AJ/SBD/PQ/mAP/sAP metric values are from the TFM deck's Guatemala benchmark (the only numbers available for this segmentation comparison); the four images above are the Santo Domingo equivalents. That benchmark itself isn't in the ECEE paper's reference list -- the authors' own (unpublished) TFM comparison -- but the footprint-derived attributes it feeds into are, hence the citation below. -->

<span class="slide-ref">Ureña-Pliego et al., 2026</span>

---

<!-- _class: map -->

# Height 

<!-- MAP:height -->
<div class="map-slot map-slot--height"></div>

<span class="slide-ref">Zhu et al., 2025</span>

---

<!-- _class: figure -->

# Relative position within a block

<img src="./figures/relative_position_explanation.jpg" class="relpos-figure">

<span class="slide-ref">Ureña-Pliego et al., 2026</span>

---

<!-- _class: map -->

# Relative position within a block

<!-- MAP:relative_position -->
<div class="map-slot map-slot--relative_position"></div>

<span class="slide-ref">Ureña-Pliego et al., 2026</span>

---

<!-- _class: figure -->

# Footprint shape

<div class="shape-row">
<img src="./figures/box_idealization_and_eccentricity.jpg" class="shape-figure">
<img src="./figures/basic_lengths_example.jpg" class="shape-figure">
</div>

<span class="slide-ref">Ureña-Pliego et al., 2026</span>

---

<!-- _class: map -->

# Footprint shape

<!-- MAP:shape_parameters -->
<div class="map-slot map-slot--shape_parameters"></div>

<span class="slide-ref">Ureña-Pliego et al., 2026</span>

---

<!-- _class: map -->

# Roof cover material

<!-- MAP:roof_material -->
<div class="map-slot map-slot--roof_material"></div>

<span class="slide-ref">Torres et al., 2023</span>

---

<!-- _class: map -->

# Construction or modification year 

<!-- MAP:year -->
<div class="map-slot map-slot--year"></div>

<span class="slide-ref">Marconcini et al., 2021</span>

---

<!-- _class: figure -->

# Structural system

<div class="cnn-row">

<div class="cnn-images-box">
<img src="./figures/building_1.jpg">
<img src="./figures/building_2.jpg">
</div>

<div class="cnn-arrow">CNN</div>

<div class="cnn-result-box">CR</div>

</div>

<span class="slide-ref">[Lopes et al., 2023](https://doi.org/10.1007/978-3-031-49011-8_41)</span>

---


<!-- _class: map -->

# Structural system: Datasets

<!-- MAP:structural_system_split -->
<div class="map-slot map-slot--structural_system_split"></div>

---

<!-- _class: map -->

# Structural system: Metrics

<!-- MAP:structural_system_metrics -->
<div class="map-slot map-slot--structural_system_metrics"></div>

---

<!-- _class: map -->

# Structural system: Explainability

<!-- MAP:structural_system_feature_importance -->
<div class="map-slot map-slot--structural_system_feature_importance"></div>

---

<!-- _class: map -->

# Structural system: Generalizability

<!-- MAP:structural_system_comparison -->
<div class="map-slot map-slot--structural_system_comparison"></div>

---

# Conclusion

<div class="conclusion-row">
<!-- MAP:gem_exposure -->
<div class="map-slot map-slot--gem_exposure conclusion-item"></div>
<!-- MAP:intro_conclusion -->
<div class="map-slot map-slot--intro_conclusion conclusion-item"></div>
<img src="./figures/buildings_simulation.jpg" class="conclusion-item conclusion-figure">
</div>

---

<!-- _class: refs -->

# References

<div class="apa-refs">

<p class="apa-ref">Brzev, S., Scawthorn, C., Silva, V., et al. (2013). <em>GEM building taxonomy version 2.0</em>. https://doi.org/10.13117/GEM.EXP-MOD.TR2013.02</p>
<p class="apa-ref">GEM Foundation. (n.d.). <em>Dominican Republic exposure model</em> [Data set]. OpenQuake Global Risk Model. https://docs.openquake.org/global_risk_model/exposure/Caribbean_Central_America/Dominican_Republic/README.html</p>
<p class="apa-ref">GeomaticsCaminosUPM. (n.d.). <em>footprint_attributes</em> [Computer software]. GitHub. https://github.com/GeomaticsCaminosUPM/footprint_attributes</p>
<p class="apa-ref">Lopes, J., Gouveia, F., Silva, V., Moreira, R. S., Torres, J. M., Guerreiro, M., &amp; Reis, L. P. (2023). Using deep learning for building stock classification in seismic risk analysis. In <em>Progress in Artificial Intelligence</em> (Lecture Notes in Computer Science, pp. 523–534). Springer. https://doi.org/10.1007/978-3-031-49011-8_41</p>
<p class="apa-ref">Marconcini, M., Esch, T., et al. (2021). Understanding current trends in global urbanisation: The World Settlement Footprint suite. <em>GI_Forum</em>. https://doi.org/10.1553/giscience2021_01_s33</p>
<p class="apa-ref">Torres, Y., Martínez-Cuevas, S., et al. (2023). Using remote sensing for exposure and seismic vulnerability evaluation: Is it reliable? <em>International Journal of Remote Sensing</em>. https://doi.org/10.1080/15481603.2023.2196162</p>
<p class="apa-ref">Ureña-Pliego, M., Rodríguez-Saiz, J., Núñez-Álvarez, G., Marchamalo-Sacristán, M., &amp; González-Rodrigo, B. (2026). A methodology for the automated estimation of footprint-derived seismic behaviour modifiers in building exposure assessment. <em>Advanced Modeling and Simulation in Engineering Sciences</em>, <em>13</em>(1), Article 3. https://doi.org/10.1186/s40323-026-00323-y</p>
<p class="apa-ref">Yepes-Estrada, C., Calderon, A., et al. (2023). Global building exposure model for earthquake risk assessment. <em>Earthquake Spectra</em>. https://doi.org/10.1177/87552930231194048</p>
<p class="apa-ref">Zhu, X. X., Chen, S., Zhang, F., Shi, Y., &amp; Wang, Y. (2025). GlobalBuildingAtlas: An open global and complete dataset of building polygons, heights and LoD1 3D models. <em>Earth System Science Data</em>, <em>17</em>(12), 6647–6668. https://doi.org/10.5194/essd-17-6647-2025</p>

</div>

---

<!-- _class: title -->
<!-- _paginate: false -->
<!-- _header: '<img class="logos-top-left" src="./logos/all_logos_in_one_line_left.jpeg" alt="Funding and partner logos" /><img class="logo-riskcar" src="./logos/logo_riskcar.jpeg" alt="RISK CARIBERIA logo" />' -->

<!-- Optional faded background map. Delete these two lines to turn it off. -->
<!-- MAP:title_bg -->
<div class="map-slot map-slot--title_bg bg-map-frame"></div>

# Thank you

<div class="authors">

Miguel Ureña-Pliego<sup>1,*</sup>, Javier Rodríguez-Saiz<sup>1,2</sup>, Javier Sempere-Hernández<sup>3</sup>, Beatriz Moya-García<sup>4,5</sup>, Sebastián Rodríguez-Iturra<sup>5</sup>, Francisco Chinesta<sup>4,5</sup>, Beatriz González-Rodrigo<sup>6</sup>, Miguel Marchamalo-Sacristán<sup>1,7</sup>

</div>

<div class="affiliations">

<sup>1</sup> Departamento de Ingeniería y Morfología del Terreno, ETSICCP, Universidad Politécnica de Madrid, Spain
<sup>2</sup> Buin Ingenieros, S.L. Madrid, Spain
<sup>3</sup> Facultad de Ciencias, Universidad Nacional de Educación a Distancia, Spain
<sup>4</sup> CNRS@CREATE LTD., Singapore
<sup>5</sup> ENSAM Institute of Technology, Paris, France
<sup>6</sup> Departamento de Ingeniería y Gestión Forestal, ETSIMFYMN, Universidad Politécnica de Madrid, Spain
<sup>7</sup> Centro de I+D+i en Infraestructuras Inteligentes y Sostenibles (CIVILis), ETSICCP, Universidad Politécnica de Madrid, Spain
<br>* Corresponding author: Miguel Ureña-Pliego — <a href="mailto:miguel.urena@upm.es">miguel.urena@upm.es</a><br><a href="https://www.linkedin.com/in/miguel-urena-pliego/" class="contact-icon-link"><img src="./assets/icon_linkedin.png" class="contact-icon"> linkedin.com/in/miguel-urena-pliego</a> &nbsp;<a href="https://github.com/MiguelUrenaPliego" class="contact-icon-link"><img src="./assets/icon_github.png" class="contact-icon"> github.com/MiguelUrenaPliego</a>

</div>

<!-- Every map above is authored as a plain
     <div class="map-slot map-slot--<name>"> placeholder rather than a real
     <iframe>: Marp hard-escapes literal <iframe> AND <script> tags in the
     markdown source (a security restriction that applies even with
     `html: true`), and ALSO strips `data-*`/`style` attributes off any
     hand-written tag -- only `class` survives -- so neither a live iframe
     nor a runtime fallback script nor a data-attribute carrying its URL
     can survive Marp's own HTML conversion. scripts/inject_maps.py runs
     AFTER `marp ... -o index.html presentation.md`, editing that
     already-compiled HTML directly (outside Marp's pipeline, so none of
     the above restrictions apply) to: look up each `map-slot--<name>`
     class against maps_manifest.json for its URL, swap the placeholder for
     a real <iframe src="that URL">, and append the small fallback script
     that swaps a map for its pre-rendered GIF under figures/maps_gif/ if
     it 404s, can't be fetched (offline), or the page is opened via
     file://. See export.md. The .static.md / .gif.md variants (built by
     scripts/build_presentation_variants.py) don't need any of this -- they
     replace every placeholder with a plain <img> at markdown level, which
     Marp has no reason to touch. -->
