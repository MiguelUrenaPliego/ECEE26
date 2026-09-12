---
marp: true
theme: ecee2026
paginate: true
html: true
footer: '<img class="logo-ecee" src="./assets/ecee2026_logo.png" alt="ECEE2026 logo" /><img class="skyline" src="./assets/skyline_footer.png" alt="" /><img class="logo-rptu" src="./assets/rptu_logo.png" alt="RPTU logo" /><img class="logo-tuberlin" src="./assets/tuberlin_logo.png" alt="TU Berlin logo" /><span class="footer-caption">ML structural system classification<br>Ureña-Pliego et al.<br><a href="https://github.com/MiguelUrenaPliego/ECEE26">github.com/MiguelUrenaPliego/ECEE26</a></span>'
---

<!-- _class: title -->
<!-- _paginate: false -->
<!-- _header: '<img class="logos-top-left" src="./logos/all_logos_in_one_line_left.jpeg" alt="Funding and partner logos" /><img class="logo-riskcar" src="./logos/logo_riskcar.jpeg" alt="RISK CARIBERIA logo" />' -->

<!-- Optional faded background map. Delete this one line to turn it off. -->
<iframe class="bg-map-frame" src="./maps/intro/index.html?view=attributes_noplot"></iframe>

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
<br>* Corresponding author: Miguel Ureña-Pliego — <a href="mailto:miguel.urena@upm.es">miguel.urena@upm.es</a>

</div>

---

<!-- _class: figure -->

# Background: GEM attributes

![Building attribute taxonomy](./figures/DNA.jpg)

<span class="slide-ref">Brzev et al., 2013</span>

---

<!-- _class: figure -->

# Background: GEM exposure models

<div style="display:flex; gap:24px; align-items:center; justify-content:center; width:100%;">
<!-- MAP:gem_exposure (static fallback) -->
<img src="./figures/maps_gif/gem_exposure.jpg" alt="gem exposure map" style="width:56%; height:470px;">
<img src="./figures/buildings_simulation.jpg" style="width:40%; max-height:470px; object-fit:contain;">
</div>

<span class="slide-ref">GEM Foundation, n.d.</span>

---

<!-- _class: figure -->

# Methodology: Proposed workflow

![Proposed geospatial-to-classification workflow](./figures/proposed_workflow.jpg)

<span class="slide-ref">Yepes-Estrada et al., 2023</span>

---

# Results

---

<!-- _class: map -->

<!-- MAP:intro (static fallback) -->
<img src="./figures/maps_gif/intro.jpg" alt="intro map">

---

<!-- _class: map -->

# Attribute tour

<!-- MAP:intro_attributes (static fallback) -->
<img src="./figures/maps_gif/intro_attributes.jpg" alt="intro attributes map">

---

# Footprint geometry

<div style="display:flex; gap:30px; align-items:center; justify-content:center; width:100%; min-height:470px;">

<div style="flex:1; font-size:20px; line-height:1.3;">

<table style="border-collapse:collapse; width:100%;">
<thead>
<tr>
<th style="border:1px solid #999; padding:10px 18px;">Metric</th>
<th style="border:1px solid #999; padding:10px 28px;">Mask2Former</th>
<th style="border:1px solid #999; padding:10px 28px;">SAM2</th>
<th style="border:1px solid #999; padding:10px 28px;">Microsoft</th>
</tr>
</thead>
<tbody>
<tr>
<td style="border:1px solid #999; padding:10px 18px;">AJ</td>
<td style="border:1px solid #999; padding:10px 28px;">0.580</td>
<td style="border:1px solid #999; padding:10px 28px;">0.630</td>
<td style="border:1px solid #999; padding:10px 28px;">0.099</td>
</tr>
<tr>
<td style="border:1px solid #999; padding:10px 18px;">SBD</td>
<td style="border:1px solid #999; padding:10px 28px;">0.560</td>
<td style="border:1px solid #999; padding:10px 28px;">0.737</td>
<td style="border:1px solid #999; padding:10px 28px;">0.124</td>
</tr>
<tr>
<td style="border:1px solid #999; padding:10px 18px;">PQ</td>
<td style="border:1px solid #999; padding:10px 28px;">0.446</td>
<td style="border:1px solid #999; padding:10px 28px;">0.530</td>
<td style="border:1px solid #999; padding:10px 28px;">0.002</td>
</tr>
<tr>
<td style="border:1px solid #999; padding:10px 18px;">mAP</td>
<td style="border:1px solid #999; padding:10px 28px;">0.224</td>
<td style="border:1px solid #999; padding:10px 28px;">0.277</td>
<td style="border:1px solid #999; padding:10px 28px;">0.0003</td>
</tr>
<tr>
<td style="border:1px solid #999; padding:10px 18px;">sAP</td>
<td style="border:1px solid #999; padding:10px 28px;">0.370</td>
<td style="border:1px solid #999; padding:10px 28px;">0.526</td>
<td style="border:1px solid #999; padding:10px 28px;">0.044</td>
</tr>
</tbody>
</table>

</div>

<div style="flex:1; max-width:460px;">

<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:16px; text-align:center">

<div>
<div style="width:100%; aspect-ratio:1/1;">
<img src="figures/sd_30cm_gt.jpg" style="width:100%; height:100%; object-fit:cover;">
</div>
<div>Santo Domingo GT</div>
</div>

<div>
<div style="width:100%; aspect-ratio:1/1;">
<img src="figures/mask2former_sd_30cm.jpg" style="width:100%; height:100%; object-fit:cover;">
</div>
<div>Mask2Former</div>
</div>

<div>
<div style="width:100%; aspect-ratio:1/1;">
<img src="figures/SAM2_sd.jpg" style="width:100%; height:100%; object-fit:cover;">
</div>
<div>SAM2</div>
</div>

<div>
<div style="width:100%; aspect-ratio:1/1;">
<img src="figures/santo_domingo_microsoft.jpg" style="width:100%; height:100%; object-fit:cover;">
</div>
<div>Microsoft</div>
</div>

</div>

</div>

</div>

<!-- Note: these AJ/SBD/PQ/mAP/sAP metric values are from the TFM deck's Guatemala benchmark (the only numbers available for this segmentation comparison); the four images above are the Santo Domingo equivalents. No slide-ref here: this segmentation benchmark isn't in the ECEE paper's reference list — it's the authors' own (unpublished) TFM comparison. -->

---

<!-- _class: map -->

<!-- MAP:height (static fallback) -->
<img src="./figures/maps_gif/height.jpg" alt="height map">

<span class="slide-ref">Zhu et al., 2025</span>

---

<!-- _class: figure -->

# Relative position within a block

<img src="./figures/relative_position_explanation.jpg" style="max-width:70%; max-height:470px; object-fit:contain;">

<span class="slide-ref">Ureña Pliego et al., 2025</span>

---

<!-- _class: map -->

<!-- MAP:relative_position (static fallback) -->
<img src="./figures/maps_gif/relative_position.jpg" alt="relative position map">

<span class="slide-ref">Ureña Pliego et al., 2025</span>

---

<!-- _class: figure -->

# Footprint shape quantification

<div style="display:flex; gap:28px; align-items:center; justify-content:center; width:100%;">
<img src="./figures/box_idealization_and_eccentricity.jpg" style="max-width:48%; max-height:460px; object-fit:contain;">
<img src="./figures/basic_lengths_example.jpg" style="max-width:48%; max-height:460px; object-fit:contain;">
</div>

<span class="slide-ref">Ureña Pliego et al., 2025</span>

---

<!-- _class: map -->

<!-- MAP:shape_parameters (static fallback) -->
<img src="./figures/maps_gif/shape_parameters.jpg" alt="shape parameters map">

<span class="slide-ref">Ureña Pliego et al., 2025</span>

---

<!-- _class: map -->

<!-- MAP:roof_material (static fallback) -->
<img src="./figures/maps_gif/roof_material.jpg" alt="roof material map">

<span class="slide-ref">Torres et al., 2023</span>

---

<!-- _class: map -->

<!-- MAP:year (static fallback) -->
<img src="./figures/maps_gif/year.jpg" alt="year map">

<span class="slide-ref">Marconcini et al., 2021</span>

---

# Structural system

---

<!-- _class: map -->

<!-- MAP:structural_system_split (static fallback) -->
<img src="./figures/maps_gif/structural_system_split.jpg" alt="structural system split map">

---

<!-- _class: map -->

<!-- MAP:structural_system_metrics (static fallback) -->
<img src="./figures/maps_gif/structural_system_metrics.jpg" alt="structural system metrics map">

---

<!-- _class: map -->

<!-- MAP:structural_system_feature_importance (static fallback) -->
<img src="./figures/maps_gif/structural_system_feature_importance.jpg" alt="structural system feature importance map">

---

<!-- _class: map -->

<!-- MAP:structural_system_comparison (static fallback) -->
<img src="./figures/maps_gif/structural_system_comparison.jpg" alt="structural system comparison map">

---

# Conclusion

<div style="display:flex; gap:20px; align-items:center; justify-content:center; width:100%; margin-top:16px;">
<!-- MAP:gem_exposure (static fallback) -->
<img src="./figures/maps_gif/gem_exposure.jpg" alt="gem exposure map" style="width:32%; height:420px;">
<!-- MAP:intro_conclusion (static fallback) -->
<img src="./figures/maps_gif/intro_conclusion.jpg" alt="intro conclusion map" style="width:32%; height:420px;">
<img src="./figures/buildings_simulation.jpg" style="width:32%; height:420px; object-fit:contain;">
</div>

---

<!-- _class: refs -->

# References

<div class="apa-refs">

<p class="apa-ref">Bishop, C. M. (2006). <em>Pattern recognition and machine learning</em>. Springer.</p>
<p class="apa-ref">Brzev, S., Scawthorn, C., Silva, V., et al. (2013). <em>GEM building taxonomy version 2.0</em>. https://doi.org/10.13117/GEM.EXP-MOD.TR2013.02</p>
<p class="apa-ref">GEM Foundation. (n.d.). <em>Dominican Republic exposure model</em> [Data set]. OpenQuake Global Risk Model. https://docs.openquake.org/global_risk_model/exposure/Caribbean_Central_America/Dominican_Republic/README.html</p>
<p class="apa-ref">GeomaticsCaminosUPM. (n.d.). <em>SeismicBuildingExposure</em> [Computer software]. GitHub. https://github.com/GeomaticsCaminosUPM/SeismicBuildingExposure</p>
<p class="apa-ref">Hollmann, N., Müller, S., et al. (2022). <em>TabPFN: A transformer that solves small tabular classification problems in a second</em>. https://doi.org/10.48550/arXiv.2207.01848</p>
<p class="apa-ref">Hollmann, N., Müller, S., et al. (2025). Accurate predictions on small data with a tabular foundation model. <em>Nature</em>. https://doi.org/10.1038/s41586-024-08328-6</p>
<p class="apa-ref">Jiménez-Martínez, M., Navas-Sánchez, L., et al. (2024). A methodology to assess and select seismic fragility curves: Calibration from expert survey and fuzzy analysis. <em>International Journal of Disaster Risk Reduction</em>. https://doi.org/10.1016/j.ijdrr.2024.104930</p>
<p class="apa-ref">Marconcini, M., Esch, T., et al. (2021). Understanding current trends in global urbanisation: The World Settlement Footprint suite. <em>GI_Forum</em>. https://doi.org/10.1553/giscience2021_01_s33</p>
<p class="apa-ref">Torres, Y., Martínez-Cuevas, S., et al. (2023). Using remote sensing for exposure and seismic vulnerability evaluation: Is it reliable? <em>International Journal of Remote Sensing</em>. https://doi.org/10.1080/15481603.2023.2196162</p>
<p class="apa-ref">Torres-Olivares, S., et al. (2025). Numerical study on the seismic behavior of aggregate reinforced concrete block masonry buildings. <em>Bulletin of Earthquake Engineering</em>. https://doi.org/10.1007/s10518-025-02262-2</p>
<p class="apa-ref">Ureña Pliego, M., Rodríguez Saiz, J., et al. (2025). <em>A methodology for the automated estimation of seismic behavior modifiers from building footprints</em> [Preprint]. SSRN. https://www.ssrn.com/abstract=5419010</p>
<p class="apa-ref">Yepes-Estrada, C., Calderon, A., et al. (2023). Global building exposure model for earthquake risk assessment. <em>Earthquake Spectra</em>. https://doi.org/10.1177/87552930231194048</p>
<p class="apa-ref">Zhu, X. X., Chen, S., Zhang, F., Shi, Y., &amp; Wang, Y. (2025). GlobalBuildingAtlas: An open global and complete dataset of building polygons, heights and LoD1 3D models. <em>Earth System Science Data</em>, <em>17</em>(12), 6647–6668. https://doi.org/10.5194/essd-17-6647-2025</p>

</div>

---

<!-- _class: title -->
<!-- _paginate: false -->
<!-- _header: '<img class="logos-top-left" src="./logos/all_logos_in_one_line_left.jpeg" alt="Funding and partner logos" /><img class="logo-riskcar" src="./logos/logo_riskcar.jpeg" alt="RISK CARIBERIA logo" />' -->

<!-- Optional faded background map. Delete this one line to turn it off. -->
<iframe class="bg-map-frame" src="./maps/intro/index.html?view=attributes_noplot"></iframe>

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
<br>* Corresponding author: Miguel Ureña-Pliego — <a href="mailto:miguel.urena@upm.es">miguel.urena@upm.es</a>

</div>

<!-- Fallback: if a live map iframe 404s, can't be fetched (offline), or is
     opened via file:// (maps need HTTP for their own fetch() calls), swap it
     for its pre-rendered GIF under figures/maps_gif/. Only active in this
     "live" presentation.md — the .static.md / .gif.md variants (built by
     scripts/build_presentation_variants.py) don't need it, they never embed
     a live iframe in the first place. -->
<script>
(function () {
  function fallback(iframe) {
    var name = iframe.getAttribute('data-map-name');
    if (!name || iframe.dataset.fellBack) return;
    iframe.dataset.fellBack = '1';
    var img = document.createElement('img');
    img.src = './figures/maps_gif/' + name + '.gif';
    img.alt = name.replace(/_/g, ' ') + ' map (offline fallback)';
    var style = iframe.getAttribute('style');
    if (style) img.setAttribute('style', style);
    if (iframe.className) img.className = iframe.className;
    iframe.replaceWith(img);
  }

  document.querySelectorAll('iframe[data-map-name]').forEach(function (iframe) {
    if (location.protocol === 'file:') { fallback(iframe); return; }
    fetch(iframe.getAttribute('src'), { method: 'HEAD' })
      .then(function (r) { if (!r.ok) fallback(iframe); })
      .catch(function () { fallback(iframe); });
    var loaded = false;
    iframe.addEventListener('load', function () { loaded = true; });
    setTimeout(function () { if (!loaded) fallback(iframe); }, 6000);
  });
})();
</script>
